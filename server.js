//server.js

import "dotenv/config";
import express from "express";
import session from "express-session";
import axios from 'axios';
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LASTFM_ROOT = "https://ws.audioscrobbler.com/2.0/";
const AUTH_URL = "https://www.last.fm/api/auth";

const app = express();
const apiKey = process.env.LASTFM_API_KEY;
const apiSecret = process.env.LASTFM_API_SECRET;
const isProduction = process.env.NODE_ENV === "production";
const configuredBaseUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
const sessionSecret = process.env.SESSION_SECRET;

if (isProduction && !sessionSecret) {
  throw new Error("SESSION_SECRET is required when NODE_ENV=production");
}

if (!apiKey || !apiSecret) {
  console.warn("Missing LASTFM_API_KEY or LASTFM_API_SECRET in .env — auth and some features will fail.");
}

app.use(express.json());
// Trust Render/hosted proxy so secure cookies and req.protocol work correctly.
app.set("trust proxy", 1);
app.use(
  session({
    secret: sessionSecret || "dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year (persist login across restarts)
    },
  })
);

app.use(express.static(join(__dirname, "public")));

function md5(str) {
  return createHash("md5").update(str, "utf8").digest("hex");
}

function buildApiSig(params) {
  const sorted = Object.keys(params)
    .filter((k) => k !== "format" && k !== "callback")
    .sort();
  const str = sorted.map((k) => k + params[k]).join("");
  return md5(str + apiSecret);
}

// ——— In-memory response cache ———
//
// Keyed by serialised params. Each entry stores the parsed JSON and an
// expiry timestamp. TTLs are tuned per method: artist metadata is stable
// for hours; per-user stats are fresh enough after a few minutes.

const apiCache = new Map();

const METHOD_TTL_MS = {
  "artist.getInfo":            6 * 60 * 60 * 1000, // 6 h   — artist images/bio rarely change
  "user.getTopArtists":            5 * 60 * 1000,  // 5 min
  "user.getTopTracks":             5 * 60 * 1000,  // 5 min
  "user.getRecentTracks":          2 * 60 * 1000,  // 2 min
  "user.getInfo":                  5 * 60 * 1000,  // 5 min
  "user.getWeeklyChartList":      60 * 60 * 1000,  // 1 h   — new week added weekly
  "user.getWeeklyArtistChart": 24 * 60 * 60 * 1000, // 24 h — past weeks are immutable
  "user.getWeeklyTrackChart":  24 * 60 * 60 * 1000, // 24 h — past weeks are immutable
};
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 min fallback

function cacheGet(key) {
  const entry = apiCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { apiCache.delete(key); return null; }
  return entry.data;
}

function cacheSet(key, data, ttlMs) {
  apiCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// Last.fm error codes that are transient and safe to retry.
const LASTFM_RETRYABLE = new Set([11, 16, 29]); // service offline, temp error, rate limit

async function lastfmGet(params, _attempt = 0) {
  const cacheKey = JSON.stringify(params);
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const clean = Object.fromEntries(
    Object.entries({ ...params, format: "json" }).filter(
      ([, v]) => v != null && v !== ""
    )
  );
  const search = new URLSearchParams(clean);
  const url = `${LASTFM_ROOT}?${search}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "LastfmWebapp/1.0 (Custom Web App)" },
  });
  const data = await res.json();

  if (data.error) {
    // Retry transient errors with exponential backoff (max 3 retries).
    if (LASTFM_RETRYABLE.has(data.error) && _attempt < 3) {
      const delay = 1000 * Math.pow(2, _attempt); // 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, delay));
      return lastfmGet(params, _attempt + 1);
    }
    throw new Error(data.message || `Last.fm error ${data.error}`);
  }

  const ttl = METHOD_TTL_MS[params.method] ?? DEFAULT_TTL_MS;
  cacheSet(cacheKey, data, ttl);
  return data;
}

async function lastfmPost(params) {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([k, v]) => v != null && v !== "" && k !== "format" && k !== "callback")
  );
  clean.api_sig = buildApiSig(clean);
  clean.format = "json";
  const res = await fetch(LASTFM_ROOT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "LastfmWebapp/1.0 (Custom Web App)",
    },
    body: new URLSearchParams(clean).toString(),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.message || `Last.fm error ${data.error}`);
  return data;
}

function getBaseUrl(req) {
  if (configuredBaseUrl) return configuredBaseUrl;
  return `${req.protocol}://${req.get("host")}`;
}

// ——— Auth ———

app.get("/auth/login", (req, res) => {
  const cb = `${getBaseUrl(req)}/auth/callback`;
  const url = `${AUTH_URL}/?api_key=${apiKey}&cb=${encodeURIComponent(cb)}`;
  res.redirect(url);
});

app.get("/auth/callback", async (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.redirect("/?error=no_token");
  }
  try {
    const params = {
      method: "auth.getSession",
      api_key: apiKey,
      token: token,
    };
    const data = await lastfmPost(params);
    const sk = data?.session?.key;
    const user = data?.session?.name;
    if (!sk || !user) {
      return res.redirect("/?error=session_failed");
    }
    req.session.lastfmSessionKey = sk;
    req.session.lastfmUsername = user;
    // Also store username in a readable cookie for the frontend.
    // (Session cookie remains the source of truth for authenticated operations.)
    res.cookie("lastfm_user", user, {
      httpOnly: false,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year
    });
    res.redirect("/");
  } catch (e) {
    console.error(e);
    res.redirect("/?error=" + encodeURIComponent(e.message));
  }
});

app.post("/api/session/username", (req, res) => {
  const username = (req.body?.username || "").trim();
  if (!username) return res.status(400).json({ error: "Username required" });
  req.session.lastfmUsername = username;
  res.cookie("lastfm_user", username, {
    httpOnly: false,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });
  res.json({ ok: true, username });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {});
  res.clearCookie("lastfm_user");
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  if (!req.session?.lastfmUsername) {
    return res.status(401).json({ error: "Not logged in" });
  }
  res.json({
    username: req.session.lastfmUsername,
    sessionKey: req.session.lastfmSessionKey ? "[REDACTED]" : null,
  });
});

// ——— Public proxy (no auth required) ———

app.get("/api/lastfm", async (req, res) => {
  const method = req.query.method;
  if (!method) {
    return res.status(400).json({ error: "Missing method" });
  }
  const params = { method, api_key: apiKey };
  for (const [k, v] of Object.entries(req.query)) {
    if (k !== "method" && v !== undefined && v !== "") params[k] = v;
  }
  try {
    const data = await lastfmGet(params);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ——— Authenticated proxy (uses session key) ———

app.get("/api/lastfm/auth", async (req, res) => {
  const sk = req.session?.lastfmSessionKey;
  if (!sk) {
    return res.status(401).json({ error: "Not logged in" });
  }
  const method = req.query.method;
  if (!method) {
    return res.status(400).json({ error: "Missing method" });
  }
  const params = { method, api_key: apiKey, sk };
  for (const [k, v] of Object.entries(req.query)) {
    if (k !== "method" && v !== undefined && v !== "") params[k] = v;
  }
  try {
    const data = await lastfmPost(params);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/lastfm/auth", express.urlencoded({ extended: true }), async (req, res) => {
  const sk = req.session?.lastfmSessionKey;
  if (!sk) {
    return res.status(401).json({ error: "Not logged in" });
  }
  const method = req.body?.method;
  if (!method) {
    return res.status(400).json({ error: "Missing method" });
  }
  const params = { method, api_key: apiKey, sk, ...req.body };
  delete params.method;
  try {
    const data = await lastfmPost(params);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ——— Custom “functions the website doesn’t have” ———

// Export recent tracks as JSON (with optional date range)
app.get("/api/custom/recent-export", async (req, res) => {
  const user = req.query.user || req.session?.lastfmUsername;
  if (!user) {
    return res.status(400).json({ error: "Provide ?user= or log in" });
  }
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 200);
  const page = parseInt(req.query.page, 10) || 1;
  try {
    const data = await lastfmGet({
      method: "user.getRecentTracks",
      api_key: apiKey,
      user,
      limit: String(limit),
      page: String(page),
      extended: "1",
    });
    const tracks = data?.recenttracks?.track ?? [];
    res.json({ user, page, limit, tracks });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Top artists across a period (easy to extend to CSV export, etc.)
app.get("/api/custom/top-artists", async (req, res) => {
  const user = req.query.user || req.session?.lastfmUsername;
  if (!user) {
    return res.status(400).json({ error: "Provide ?user= or log in" });
  }
  const period = req.query.period || "12month";
  const wanted = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const perPage = 50; // Last.fm caps per-page at 50 for this method
  const pagesNeeded = Math.ceil(wanted / perPage);
  try {
    const pages = await Promise.all(
      Array.from({ length: pagesNeeded }, (_, i) =>
        lastfmGet({
          method: "user.getTopArtists",
          api_key: apiKey,
          user,
          period,
          limit: String(perPage),
          page: String(i + 1),
        })
      )
    );
    const artists = pages.flatMap(d => d?.topartists?.artist ?? []).slice(0, wanted);
    res.json({ user, period, artists });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// User's top tracks for a specific artist.
//
// Strategy:
// - First try: `user.getTopTracks` (fast, but can miss artists if they're below the cutoff).
// - Fallback: scan `user.getRecentTracks` (time-windowed by period when possible) and aggregate playcounts
//   per track for the artist. This finds artists even if they're not in the user's top tracks list.
app.get("/api/custom/top-tracks-by-artist", async (req, res) => {
  const user = req.query.user || req.session?.lastfmUsername;
  if (!user) {
    return res.status(400).json({ error: "Provide ?user= or log in" });
  }
  const artistQuery = (req.query.artist || "").trim();
  if (!artistQuery) {
    return res.status(400).json({ error: "Provide artist= (artist name to search)" });
  }

  const period = req.query.period || "12month";
  const source = String(req.query.source || "auto").toLowerCase(); // auto | toptracks | recent
  const maxPages = Math.min(parseInt(req.query.max_pages, 10) || 10, 200);
  const normalize = (s) => String(s || "").toLowerCase().trim();
  const target = normalize(artistQuery);

  const nowSec = Math.floor(Date.now() / 1000);
  const periodToFrom = (p) => {
    switch (p) {
      case "7day":
        return nowSec - 7 * 24 * 60 * 60;
      case "1month":
        return nowSec - 30 * 24 * 60 * 60;
      case "3month":
        return nowSec - 90 * 24 * 60 * 60;
      case "6month":
        return nowSec - 180 * 24 * 60 * 60;
      case "12month":
        return nowSec - 365 * 24 * 60 * 60;
      case "overall":
      default:
        return null;
    }
  };

  try {
    // 1) Attempt: filter the user's top tracks for this period
    if (source === "auto" || source === "toptracks") {
      const tracksByArtist = [];
      const topTrackPages = Math.min(maxPages, 10);

      for (let page = 1; page <= topTrackPages; page++) {
        const data = await lastfmGet({
          method: "user.getTopTracks",
          api_key: apiKey,
          user,
          period,
          limit: "200",
          page: String(page),
        });
        const tracks = data?.toptracks?.track;
        if (!tracks) break;
        const list = Array.isArray(tracks) ? tracks : [tracks];

        for (const t of list) {
          const artistName = t.artist?.name ?? t.artist?.["#text"] ?? "";
          if (normalize(artistName) !== target) continue;
          tracksByArtist.push({
            name: t.name,
            playcount: parseInt(t.playcount, 10) || 0,
            url: t.url,
            artist: artistName,
            mbid: t.mbid || t.artist?.mbid,
          });
        }

        if (list.length < 200) break;
      }

      tracksByArtist.sort((a, b) => b.playcount - a.playcount);
      if (source === "toptracks" || tracksByArtist.length > 0) {
        return res.json({ user, artist: artistQuery, period, source: "toptracks", tracks: tracksByArtist });
      }
    }

    // 2) Fallback: aggregate from recent tracks (more complete, but limited by how far back we scan)
    if (source === "auto" || source === "recent") {
      const from = periodToFrom(period);
      const counts = new Map(); // key -> track summary

      for (let page = 1; page <= maxPages; page++) {
        const data = await lastfmGet({
          method: "user.getRecentTracks",
          api_key: apiKey,
          user,
          limit: "200",
          page: String(page),
          extended: "1",
          ...(from ? { from: String(from) } : {}),
        });
        const tracks = data?.recenttracks?.track;
        if (!tracks) break;
        const list = Array.isArray(tracks) ? tracks : [tracks];

        for (const t of list) {
          const artistName = t.artist?.name ?? t.artist?.["#text"] ?? "";
          if (normalize(artistName) !== target) continue;

          const trackName = t.name || "";
          const mbid = t.mbid || "";
          const key = `${normalize(artistName)}::${normalize(trackName)}::${mbid}`;
          const prev = counts.get(key);
          if (prev) {
            prev.playcount += 1;
          } else {
            counts.set(key, {
              name: trackName,
              playcount: 1,
              url: t.url,
              artist: artistName,
              mbid: mbid,
            });
          }
        }

        if (list.length < 200) break;
      }

      const tracksByArtist = Array.from(counts.values()).sort((a, b) => b.playcount - a.playcount);
      return res.json({ user, artist: artistQuery, period, source: "recent", tracks: tracksByArtist });
    }

    return res.status(400).json({ error: "Invalid source. Use source=auto|toptracks|recent" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// First time a user scrobbled an artist (or a specific track by that artist).
//
// Two-phase strategy:
//
// Phase 1 — Binary search over weekly charts (~9 API calls).
//   user.getWeeklyArtistChart / user.getWeeklyTrackChart tell us the first week
//   the target appeared with enough plays to be charted. This gives a reliable upper
//   bound (T_upper) on the first listen date. However, the weekly chart may omit
//   a single-play first listen (e.g. a one-off discovery before regular listening
//   started), so T_upper may be slightly later than the real first listen.
//
// Phase 2 — Backward scan from T_upper through actual scrobbles.
//   We fetch user.getRecentTracks with to=T_upper, starting from page 1 (newest
//   tracks before T_upper) and walking toward older pages. We accumulate the oldest
//   matching scrobble and stop once MAX_EMPTY_PAGES consecutive pages contain no
//   match (meaning we have gone far enough back in time). This correctly finds sparse
//   first listens that the weekly chart missed.
app.get("/api/custom/first-listen", async (req, res) => {
  const user = req.query.user || req.session?.lastfmUsername;
  if (!user) {
    return res.status(400).json({ error: "Provide ?user= or log in" });
  }
  const artistQuery = (req.query.artist || "").trim();
  if (!artistQuery) {
    return res.status(400).json({ error: "Provide artist= (artist name)" });
  }
  const trackQuery = (req.query.track || "").trim();
  const normalize = (s) => String(s || "").toLowerCase().trim();
  const targetArtist = normalize(artistQuery);
  const targetTrack = trackQuery ? normalize(trackQuery) : null;

  // When the artist IS found via weekly charts, T_upper is a tight window (just that
  // first week), so Phase 2 finds the match within a handful of pages.  50 consecutive
  // empty pages is a generous buffer for any within-week gap.
  const MAX_EMPTY_PAGES = 50;
  // Hard cap on total pages scanned when the weekly chart DID locate the artist.
  const MAX_SCAN_PAGES = 500;
  // When the artist is NOT found in any weekly chart (very few total plays), we scan
  // from the newest scrobble with NO early-stopping — just a higher page cap.
  // 600 pages × 200 = 120 000 tracks ≈ ~3–4 years of history from today.
  // Artists with first listens older than that AND too few plays to appear in any
  // weekly chart are a known limitation of this fallback path.
  const MAX_SCAN_PAGES_FALLBACK = 600;

  try {
    // ── Phase 1: binary search over weekly charts to find T_upper ──────────────

    const chartListData = await lastfmGet({
      method: "user.getWeeklyChartList",
      api_key: apiKey,
      user,
    });
    const rawCharts = chartListData?.weeklychartlist?.chart ?? [];
    const chartList = (Array.isArray(rawCharts) ? rawCharts : [rawCharts])
      .filter((c) => c?.from && c?.to)
      .sort((a, b) => parseInt(a.from, 10) - parseInt(b.from, 10)); // oldest first

    if (chartList.length === 0) {
      return res.json({ user, artist: artistQuery, found: false, message: "No weekly chart history available" });
    }

    const targetInWeek = async (week) => {
      try {
        if (targetTrack) {
          const data = await lastfmGet({
            method: "user.getWeeklyTrackChart",
            api_key: apiKey,
            user,
            from: week.from,
            to: week.to,
          });
          const list = data?.weeklytrackchart?.track ?? [];
          return (Array.isArray(list) ? list : [list]).some(
            (t) =>
              normalize(t.artist?.["#text"] ?? t.artist?.name ?? "") === targetArtist &&
              normalize(t.name ?? "") === targetTrack
          );
        } else {
          const data = await lastfmGet({
            method: "user.getWeeklyArtistChart",
            api_key: apiKey,
            user,
            from: week.from,
            to: week.to,
          });
          const list = data?.weeklyartistchart?.artist ?? [];
          return (Array.isArray(list) ? list : [list]).some(
            (a) => normalize(a.name ?? a["#text"] ?? "") === targetArtist
          );
        }
      } catch {
        return false;
      }
    };

    // Phase 1a — binary search to find an upper-bound week index.
    // Assumes the listening pattern is monotone [false...true]; works perfectly for
    // artists listened to continuously. Results are cached 24 h so the ~10 calls here
    // only hit the network once per user per day.
    let lo = 0;
    let hi = chartList.length - 1;
    let upperBoundIdx = -1;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (await targetInWeek(chartList[mid])) {
        upperBoundIdx = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    // Phase 1b — forward linear scan from week 0 to upperBoundIdx (artist-only queries).
    // Binary search assumes a monotone [false…true] pattern and breaks when the user
    // heard an artist once early on, had a long gap, then resumed regular listening
    // (e.g. one play Jan 2022, silence, heavy listening Aug 2023+).
    // A forward scan guarantees we find the true first charted week.
    // Weekly-chart results are cached 24 h so this is only slow on a cold first search.
    //
    // Track queries are intentionally excluded: a specific song's chart pattern is
    // almost always monotone (you don't hear one track, forget it for months, then
    // rediscover it repeatedly), so binary search alone is correct and we avoid
    // making potentially hundreds of getWeeklyTrackChart calls.
    let firstChartWeekIdx = upperBoundIdx;
    if (!targetTrack && upperBoundIdx > 0) {
      for (let i = 0; i < upperBoundIdx; i++) {
        if (await targetInWeek(chartList[i])) {
          firstChartWeekIdx = i;
          break;
        }
      }
    }

    // T_upper: scan all scrobbles up to (and including) the end of the first chart week.
    // If the artist never charted, use the end of the most recent chart (= scan everything).
    const T_upper =
      firstChartWeekIdx !== -1
        ? parseInt(chartList[firstChartWeekIdx].to, 10)
        : parseInt(chartList[chartList.length - 1].to, 10);

    // ── Phase 2: backward scan from T_upper through actual scrobbles ─────────────
    //
    // Page 1 = most-recent scrobbles before T_upper.
    // We walk from page 1 toward older pages, tracking the oldest match found.
    //
    // Two modes:
    //   • Weekly-chart hit  (upperBoundIdx !== -1): T_upper is a tight 1-week window;
    //     the match appears within a few pages.  Use MAX_EMPTY_PAGES early-stopping.
    //   • Fallback          (upperBoundIdx === -1): artist had too few plays to chart.
    //     Disable early-stopping and scan up to MAX_SCAN_PAGES_FALLBACK pages so we
    //     don't miss sparse plays separated by large gaps.

    const chartHit = upperBoundIdx !== -1;
    const scanLimit = chartHit ? MAX_SCAN_PAGES : MAX_SCAN_PAGES_FALLBACK;

    const page1Data = await lastfmGet({
      method: "user.getRecentTracks",
      api_key: apiKey,
      user,
      to: String(T_upper),
      limit: "200",
      page: "1",
      extended: "1",
    });

    const totalPagesPre = parseInt(page1Data?.recenttracks?.["@attr"]?.totalPages, 10) || 1;

    let firstMatch = null;
    let consecutiveEmpty = 0;

    for (let p = 1; p <= Math.min(totalPagesPre, scanLimit); p++) {
      const data =
        p === 1
          ? page1Data
          : await lastfmGet({
              method: "user.getRecentTracks",
              api_key: apiKey,
              user,
              to: String(T_upper),
              limit: "200",
              page: String(p),
              extended: "1",
            });

      const raw = data?.recenttracks?.track ?? [];
      const tracks = (Array.isArray(raw) ? raw : [raw]).filter((t) => t?.date?.uts);

      let foundInPage = false;
      for (const t of tracks) {
        const artistName = t.artist?.name ?? t.artist?.["#text"] ?? "";
        if (normalize(artistName) !== targetArtist) continue;
        if (targetTrack && normalize(t.name) !== targetTrack) continue;
        foundInPage = true;
        const ts = parseInt(t.date.uts, 10);
        if (!firstMatch || ts < firstMatch.timestamp) {
          firstMatch = {
            track: t.name,
            artist: artistName,
            date: t.date["#text"],
            timestamp: ts,
            url: t.url,
          };
        }
      }

      if (foundInPage) {
        consecutiveEmpty = 0;
      } else if (chartHit) {
        // Only apply early-stopping when we have a tight T_upper from the weekly chart.
        consecutiveEmpty++;
        if (consecutiveEmpty >= MAX_EMPTY_PAGES) break;
      }
      // Fallback path: no early-stopping — scan the full scanLimit.
    }

    if (!firstMatch) {
      return res.json({
        user,
        artist: artistQuery,
        ...(trackQuery && { track: trackQuery }),
        found: false,
        message: `"${artistQuery}${trackQuery ? ` — ${trackQuery}` : ""}" not found in your scrobble history.`,
      });
    }

    // Count scrobbles newer than the first listen to calculate the Last.fm library page.
    // Last.fm's website shows 50 tracks per page at last.fm/user/{user}/library?page=N.
    let libraryPage = null;
    try {
      const afterData = await lastfmGet({
        method: "user.getRecentTracks",
        api_key: apiKey,
        user,
        from: String(firstMatch.timestamp + 1),
        limit: "1",
      });
      const tracksAfter = parseInt(afterData?.recenttracks?.["@attr"]?.total, 10) || 0;
      libraryPage = Math.floor(tracksAfter / 50) + 1;
    } catch (_) {}

    return res.json({
      user,
      artist: artistQuery,
      ...(trackQuery && { track: trackQuery }),
      found: true,
      firstListen: {
        ...firstMatch,
        ...(libraryPage && { libraryPage }),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/artist-image-proxy", async (req, res) => {
  const artistName = req.query.artist;
  const username = req.session?.lastfmUsername || "";

  // This follows your old getArtistImage promise logic exactly
  try {
    const data = await lastfmGet({
      method: 'artist.getInfo',
      api_key: apiKey,
      artist: artistName,
      user: username
    });

    axios({
      method: 'get',
      url: data.artist.image[3]['#text'], // Index 3 as in original
      responseType: 'arraybuffer',
    })
    .then((response) => {
      const base64Image = Buffer.from(response.data, 'binary').toString('base64');
      const dataUrl = `data:${response.headers['content-type']};base64,${base64Image}`;
      res.json({ imageUrl: dataUrl });
    })
    .catch((err) => {
      res.status(500).json({ error: err.message });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  const url = configuredBaseUrl || `http://localhost:${PORT}`;
  console.log(`Last.fm webapp running at ${url}`);
  if (!isProduction) {
    try {
      const { default: open } = await import("open");
      await open(url);
    } catch (_) {
      // open package not available — visit the URL above manually
    }
  }
});
