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

async function lastfmGet(params) {
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
  if (data.error) throw new Error(data.message || `Last.fm error ${data.error}`);
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
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 50);
  try {
    const data = await lastfmGet({
      method: "user.getTopArtists",
      api_key: apiKey,
      user,
      period,
      limit: String(limit),
    });
    const artists = data?.topartists?.artist ?? [];
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
app.listen(PORT, () => {
  console.log(`Last.fm webapp running at ${configuredBaseUrl || `http://localhost:${PORT}`}`);
});
