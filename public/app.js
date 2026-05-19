// app.js

// ── DOM refs ────────────────────────────────────────────────────────────────
const usernameEl       = document.getElementById("username");
const btnChangeUser    = document.getElementById("btnChangeUser");
const hero             = document.getElementById("hero");
const welcome          = document.getElementById("welcome");
const dashboard        = document.getElementById("dashboard");
const errorBanner      = document.getElementById("error");
const usernameForm     = document.getElementById("usernameForm");
const usernameInput    = document.getElementById("usernameInput");

// Results panel
const resultsPanel      = document.getElementById("resultsPanel");
const resultsPanelTitle = document.getElementById("resultsPanelTitle");
const resultsPanelBody  = document.getElementById("resultsPanelBody");
const btnCloseResults   = document.getElementById("btnCloseResults");

// Top tracks by artist
const artistFromTop         = document.getElementById("artistFromTop");
const artistSearch          = document.getElementById("artistSearch");
const tracksByArtistPeriod  = document.getElementById("tracksByArtistPeriod");
const btnTopTracksByArtist  = document.getElementById("btnTopTracksByArtist");
const tracksByArtistResults = document.getElementById("tracksByArtistResults");
const tracksByArtistMeta    = document.getElementById("tracksByArtistMeta");
const tracksByArtistList    = document.getElementById("tracksByArtistList");

// Top artists
const topPeriod         = document.getElementById("topPeriod");
const btnTopArtists     = document.getElementById("btnTopArtists");
const topArtistsResults = document.getElementById("topArtistsResults");
const topArtistsMeta    = document.getElementById("topArtistsMeta");
const topArtistsList    = document.getElementById("topArtistsList");

// Raw API
const rawMethod = document.getElementById("rawMethod");
const rawUser   = document.getElementById("rawUser");
const btnRaw    = document.getElementById("btnRaw");

// First listen
const firstListenArtistFromTop = document.getElementById("firstListenArtistFromTop");
const firstListenArtist        = document.getElementById("firstListenArtist");
const firstListenTrack         = document.getElementById("firstListenTrack");
const btnFirstListen           = document.getElementById("btnFirstListen");
const firstListenResult        = document.getElementById("firstListenResult");

// Bubble chart
const bubblePeriod    = document.getElementById("bubblePeriod");
const bubbleCount     = document.getElementById("bubbleCount");
const btnBubbleLoad   = document.getElementById("btnBubbleLoad");
const bubbleChart     = document.getElementById("bubbleChart");
const btnBubbleExpand = document.getElementById("btnBubbleExpand");
const bubbleHint      = document.getElementById("bubbleHint");
const bubbleCardWrap  = document.getElementById("bubbleCardWrap");

// Export
const recentLimit     = document.getElementById("recentLimit");
const btnRecentExport = document.getElementById("btnRecentExport");

// ── API loading overlay ──────────────────────────────────────────────────────
let apiRequestsInFlight = 0;
let apiLoadingOverlay   = null;

function ensureApiLoadingOverlay() {
  if (apiLoadingOverlay) return apiLoadingOverlay;
  const el = document.createElement("div");
  el.className = "api-loading-overlay";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <div class="api-loading-spinner-wrap">
      <div class="api-loading-spinner" aria-hidden="true"></div>
      <div class="api-loading-text">Loading…</div>
    </div>`;
  document.body.appendChild(el);
  apiLoadingOverlay = el;
  return el;
}

function setApiLoading(active) {
  ensureApiLoadingOverlay().classList.toggle("visible", active);
  document.body.classList.toggle("is-api-loading", active);
}

function isApiRequest(input) {
  const url = new URL(typeof input === "string" ? input : (input?.url || ""), window.location.origin);
  return url.origin === window.location.origin &&
    (url.pathname.startsWith("/api/") || url.pathname === "/auth/logout");
}

async function apiFetch(input, init) {
  const track = isApiRequest(input);
  if (track) { apiRequestsInFlight += 1; setApiLoading(true); }
  try {
    return await fetch(input, init);
  } finally {
    if (track) {
      apiRequestsInFlight = Math.max(0, apiRequestsInFlight - 1);
      setApiLoading(apiRequestsInFlight > 0);
    }
  }
}

// ── Results panel ────────────────────────────────────────────────────────────
let panelSourceEl        = null;
let panelSourceParent    = null;
let panelSourceSibling   = null;

/**
 * Move `el` into the results panel, collapse the hero, and show the panel.
 * Calling again while open swaps content without re-animating hero.
 */
function openResultsPanel(title, el) {
  // Return any previously displayed element to its original position
  if (panelSourceEl && panelSourceEl.parentNode === resultsPanelBody) {
    resultsPanelBody.removeChild(panelSourceEl);
    if (panelSourceParent) {
      panelSourceParent.insertBefore(panelSourceEl, panelSourceSibling);
      panelSourceEl.hidden = true;
    }
  }

  panelSourceEl      = el;
  panelSourceParent  = el.parentNode;   // null for freshly-created elements
  panelSourceSibling = el.nextSibling;

  resultsPanelBody.innerHTML = "";
  resultsPanelBody.appendChild(el);
  el.hidden = false;

  resultsPanelTitle.textContent = title;
  resultsPanel.hidden = false;
  hero.classList.add("hero--collapsed");
}

function closeResultsPanel() {
  if (panelSourceEl) {
    if (panelSourceEl.parentNode === resultsPanelBody) {
      resultsPanelBody.removeChild(panelSourceEl);
    }
    if (panelSourceParent) {
      panelSourceParent.insertBefore(panelSourceEl, panelSourceSibling);
      panelSourceEl.hidden = true;
    }
    panelSourceEl = panelSourceParent = panelSourceSibling = null;
  }
  resultsPanelBody.innerHTML = "";
  resultsPanel.hidden = true;
  hero.classList.remove("hero--collapsed");
}

btnCloseResults.addEventListener("click", closeResultsPanel);

// ── Utilities ────────────────────────────────────────────────────────────────
function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.hidden = false;
  setTimeout(() => { errorBanner.hidden = true; }, 5000);
}


// ── Auth ─────────────────────────────────────────────────────────────────────
async function checkAuth() {
  try {
    const res  = await apiFetch("/api/me", { credentials: "include" });
    const data = await res.json();
    if (data.username) {
      usernameEl.textContent = data.username;
      btnChangeUser.hidden   = false;
      welcome.hidden         = true;
      dashboard.hidden       = false;
      loadTopArtistsForPicker();
      loadBubblePreview();
      return data.username;
    }
  } catch (_) {}
  usernameEl.textContent = "";
  btnChangeUser.hidden   = true;
  welcome.hidden         = false;
  dashboard.hidden       = true;
  clearBubbleChart();
  return null;
}

// URL error param
const _urlParams = new URLSearchParams(location.search);
const _urlErr    = _urlParams.get("error");
if (_urlErr) {
  showError(decodeURIComponent(_urlErr));
  history.replaceState({}, "", location.pathname);
}

// ── Username form ─────────────────────────────────────────────────────────────
usernameForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = usernameInput.value.trim();
  if (!username) { showError("Enter a Last.fm username."); return; }
  try {
    const res  = await apiFetch("/api/session/username", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error || "Could not set username."); return; }
    usernameInput.value = "";
    await checkAuth();
  } catch (e) { showError(e.message); }
});

btnChangeUser.addEventListener("click", async () => {
  closeResultsPanel();
  await apiFetch("/auth/logout", { method: "POST", credentials: "include" });
  await checkAuth();
});

// ── Artist dropdown population ────────────────────────────────────────────────
function populateArtistDropdown(artists) {
  [
    { sel: artistFromTop,          placeholder: "— Or type an artist below —" },
    { sel: firstListenArtistFromTop, placeholder: "— Or type an artist below —" },
  ].forEach(({ sel, placeholder }) => {
    const prev = sel.value;
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    (artists || []).forEach((a) => {
      const name = a.name ?? a["#text"] ?? "";
      if (!name) return;
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    if (prev && artists.some((a) => (a.name ?? a["#text"]) === prev)) sel.value = prev;
  });
}

async function loadTopArtistsForPicker() {
  try {
    const res  = await apiFetch("/api/custom/top-artists?period=12month&limit=50", { credentials: "include" });
    const data = await res.json();
    if (res.ok && data.artists?.length) populateArtistDropdown(data.artists);
  } catch (_) {}
}

// ── Top Tracks by Artist ──────────────────────────────────────────────────────
btnTopTracksByArtist.addEventListener("click", async () => {
  const artist = artistSearch.value.trim() || artistFromTop.value || "";
  if (!artist) { showError("Choose an artist from the list or type an artist name."); return; }
  const period = tracksByArtistPeriod.value;
  try {
    const res  = await apiFetch(
      `/api/custom/top-tracks-by-artist?artist=${encodeURIComponent(artist)}&period=${encodeURIComponent(period)}`,
      { credentials: "include" }
    );
    const data = await res.json();
    if (!res.ok) { showError(data.error || "Request failed"); return; }

    const tracks = data.tracks || [];
    tracksByArtistMeta.textContent = tracks.length
      ? `Top ${tracks.length} track${tracks.length !== 1 ? "s" : ""} by ${data.artist} (${period})`
      : `No tracks found for "${data.artist}" in ${period}. Try a different period.`;

    tracksByArtistList.innerHTML = "";
    tracks.forEach((t) => {
      const li       = document.createElement("li");
      const name     = document.createElement("span");
      name.className = "track-name";
      name.textContent = t.name;
      const pc       = document.createElement("span");
      pc.className   = "track-playcount";
      pc.textContent = `${t.playcount} play${t.playcount !== 1 ? "s" : ""}`;
      li.append(name, pc);
      if (t.url) {
        const a = document.createElement("a");
        a.className = "track-url"; a.href = t.url;
        a.target = "_blank"; a.rel = "noopener"; a.textContent = "Last.fm";
        li.appendChild(a);
      }
      tracksByArtistList.appendChild(li);
    });

    tracksByArtistResults.hidden = false;
    openResultsPanel("Top Tracks by Artist", tracksByArtistResults);
  } catch (e) { showError(e.message); }
});

// ── Top Artists ───────────────────────────────────────────────────────────────
btnTopArtists.addEventListener("click", async () => {
  const period = topPeriod.value;
  try {
    const res  = await apiFetch(
      `/api/custom/top-artists?period=${encodeURIComponent(period)}`,
      { credentials: "include" }
    );
    const data = await res.json();
    if (!res.ok) { showError(data.error || "Request failed"); return; }

    const artists = data.artists || [];
    topArtistsMeta.textContent = artists.length
      ? `Top ${artists.length} artist${artists.length !== 1 ? "s" : ""} (${period})`
      : "No top artists found for that period.";

    topArtistsList.innerHTML = "";
    artists.forEach((a) => {
      const li   = document.createElement("li");
      const name = document.createElement("span");
      name.className = "artist-name";
      name.textContent = a.name ?? a["#text"] ?? "";
      const pc  = document.createElement("span");
      pc.className = "track-playcount";
      const n = parseInt(a.playcount, 10) || 0;
      pc.textContent = `${n} play${n !== 1 ? "s" : ""}`;
      li.append(name, pc);
      if (a.url) {
        const link = document.createElement("a");
        link.className = "track-url"; link.href = a.url;
        link.target = "_blank"; link.rel = "noopener"; link.textContent = "Last.fm";
        li.appendChild(link);
      }
      topArtistsList.appendChild(li);
    });

    populateArtistDropdown(artists);
    topArtistsResults.hidden = false;
    openResultsPanel("Top Artists", topArtistsResults);
  } catch (e) { showError(e.message); }
});

// ── First Listen ──────────────────────────────────────────────────────────────
btnFirstListen.addEventListener("click", async () => {
  const artist = firstListenArtist.value.trim() || firstListenArtistFromTop.value || "";
  if (!artist) { showError("Choose an artist from the list or type an artist name."); return; }
  const track = firstListenTrack.value.trim();
  const q = new URLSearchParams({ artist });
  if (track) q.set("track", track);

  try {
    const res  = await apiFetch(`/api/custom/first-listen?${q}`, { credentials: "include" });
    const data = await res.json();
    if (!res.ok) { showError(data.error || "Request failed"); return; }

    firstListenResult.innerHTML = "";

    if (!data.found) {
      const msg = document.createElement("p");
      msg.className = "first-listen-not-found";
      msg.textContent = data.message || "No results found.";
      firstListenResult.appendChild(msg);
    } else {
      const fl = data.firstListen;
      const date = fl.timestamp
        ? new Date(fl.timestamp * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
        : fl.date || "Unknown date";

      const dateEl = document.createElement("div");
      dateEl.className = "first-listen-date";
      dateEl.textContent = date;
      firstListenResult.appendChild(dateEl);

      if (fl.track) {
        const trackEl = document.createElement("div");
        trackEl.className = "first-listen-track";
        trackEl.textContent = track ? `"${fl.track}" by ${fl.artist}` : `First track: "${fl.track}"`;
        firstListenResult.appendChild(trackEl);
      }

      if (fl.note) {
        const noteEl = document.createElement("div");
        noteEl.className = "first-listen-meta";
        noteEl.textContent = fl.note;
        firstListenResult.appendChild(noteEl);
      } else if (fl.artist) {
        const metaEl = document.createElement("div");
        metaEl.className = "first-listen-meta";
        const parts = [`Artist: ${fl.artist}`];
        if (fl.libraryPage) parts.push(`library page ${fl.libraryPage.toLocaleString()}`);
        metaEl.textContent = parts.join(" · ");
        firstListenResult.appendChild(metaEl);
      }

      if (fl.libraryPage) {
        const link = document.createElement("a");
        link.className = "first-listen-link";
        link.href = `https://www.last.fm/user/${encodeURIComponent(data.user)}/library?page=${fl.libraryPage}`;
        link.target = "_blank"; link.rel = "noopener";
        link.textContent = `View page ${fl.libraryPage.toLocaleString()} of your library →`;
        firstListenResult.appendChild(link);
      }
    }

    firstListenResult.hidden = false;
  } catch (e) { showError(e.message); }
});

// ── Export Recent Tracks ──────────────────────────────────────────────────────
btnRecentExport.addEventListener("click", async () => {
  const limit = recentLimit.value || 50;
  try {
    const res  = await apiFetch(
      `/api/custom/recent-export?limit=${encodeURIComponent(limit)}`,
      { credentials: "include" }
    );
    const data = await res.json();
    if (!res.ok) { showError(data.error || "Request failed"); return; }

    // Trigger download
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a    = document.createElement("a");
    const filename = `lastfm-recent-${data.user}-${Date.now()}.json`;
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);

    // Show success in results panel
    const resultEl = document.createElement("div");
    resultEl.className = "export-result-panel";
    resultEl.innerHTML = `
      <p class="export-success">✓ Downloaded ${data.tracks?.length ?? 0} tracks</p>
      <p class="export-meta">Saved as: ${filename}</p>`;
    openResultsPanel("Export Recent Tracks", resultEl);
  } catch (e) { showError(e.message); }
});

// ── Raw API ───────────────────────────────────────────────────────────────────
btnRaw.addEventListener("click", async () => {
  const method = rawMethod.value.trim();
  if (!method) { showError("Enter a method (e.g. user.getRecentTracks)"); return; }
  const user = rawUser.value.trim();
  const q    = new URLSearchParams({ method });
  if (user) q.set("user", user);
  try {
    const res  = await apiFetch(`/api/lastfm?${q}`, { credentials: "include" });
    const data = await res.json();
    if (!res.ok) { showError(data.error || "Request failed"); return; }
    const pre = document.createElement("pre");
    pre.className = "preview";
    pre.textContent = JSON.stringify(data, null, 2);
    openResultsPanel("Raw API", pre);
  } catch (e) { showError(e.message); }
});

// ── Bubble chart helpers ──────────────────────────────────────────────────────
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Radius scales vs median playcount: median artist ≈ baseRadius, area ∝ plays. */
function bubbleRadiusFromMedian(playcount, center, baseRadius) {
  const ratio = Math.max(playcount, 1) / Math.max(center, 1);
  const minR = 10;
  const maxR = 120;
  return clamp(baseRadius * Math.sqrt(ratio), minR, maxR) * 1.5;
}

/** Size the simulation canvas from total bubble area so large counts zoom out. */
function bubbleCanvasSize(nodes, count) {
  const totalArea = nodes.reduce((sum, n) => sum + Math.PI * n.radius * n.radius, 0);
  const paddedArea = totalArea / 0.58;
  const aspect = 4 / 3;
  const floorW = Math.max(1600, count * 11);
  const floorH = Math.max(1200, count * 8.25);
  const h = Math.max(floorH, Math.sqrt(paddedArea / aspect));
  const w = Math.max(floorW, h * aspect);
  return { w: Math.round(w), h: Math.round(h) };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  await Promise.all(
    new Array(Math.min(limit, items.length)).fill(0).map(async () => {
      while (idx < items.length) { const cur = idx++; results[cur] = await fn(items[cur], cur); }
    })
  );
  return results;
}

async function getArtistImageUrl(artistName) {
  try {
    const res  = await apiFetch(`/api/artist-image-proxy?artist=${encodeURIComponent(artistName)}`);
    const data = await res.json();
    return data.imageUrl ?? null;
  } catch (_) { return null; }
}

let bubbleSimulation = null;

function stopBubbleSimulation() {
  if (bubbleSimulation) {
    bubbleSimulation.stop();
    bubbleSimulation = null;
  }
}

function createBubbleNodes(artists, { preview = false } = {}) {
  const playcounts = artists.map((a) => parseInt(a.playcount, 10) || 0);
  const center     = median(playcounts) || 1;
  const count      = artists.length;
  const baseRadius = preview ? 72 : count > 120 ? 30 : count > 70 ? 34 : 40;
  const maxPc      = Math.max(...playcounts, 1);

  return artists.map((a) => {
    const pc   = parseInt(a.playcount, 10) || 0;
    const radius = preview
      ? clamp((58 + (pc / maxPc) * 82) * 3.5, 203, 490)
      : bubbleRadiusFromMedian(pc, center, baseRadius);
    const name = a.name ?? a["#text"] ?? "";
    const hue  = Array.from(name).reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
    return {
      name,
      playcount: pc,
      radius,
      x: 0,
      y: 0,
      imageUrl: null,
      fallbackColor: `hsl(${hue},58%,42%)`,
    };
  });
}

async function renderBubbleChart(artists, { preview = false } = {}) {
  stopBubbleSimulation();
  bubbleChart.innerHTML = "";

  const count = artists.length;
  const nodes = createBubbleNodes(artists, { preview });
  const { w: W, h: H } = bubbleCanvasSize(nodes, count);

  const spread = Math.max(preview ? 170 : 80, Math.min(W, H) * (preview ? 0.13 : 0.06));
  nodes.forEach((n) => {
    n.x = W / 2 + (Math.random() - 0.5) * spread;
    n.y = H / 2 + (Math.random() - 0.5) * spread;
  });

  bubbleChart.style.minHeight = preview
    ? ""
    : `${clamp(Math.round(H * 0.38), 320, 720)}px`;

  const svg = d3.select("#bubbleChart").append("svg")
    .attr("viewBox", `0,0,${W},${H}`)
    .attr("preserveAspectRatio", "xMinYMin meet")
    .style("font", "22px sans-serif");

  const defs = svg.append("defs");

  await mapLimit(nodes, 4, async (node, i) => {
    node.imageUrl = await getArtistImageUrl(node.name);
    if (node.imageUrl) {
      defs.append("pattern")
        .attr("id", `img-${i}`).attr("width", 1).attr("height", 1)
        .append("image")
        .attr("xlink:href", node.imageUrl)
        .attr("width",  node.radius * 2)
        .attr("height", node.radius * 2);
    }
  });

  const tooltip = d3.select("#bubbleChart").append("div").attr("class", "bubble-tooltip");

  const circles = svg.selectAll("circle").data(nodes).enter().append("circle")
    .attr("class", "bubble")
    .attr("cx", (d) => d.x).attr("cy", (d) => d.y).attr("r", (d) => d.radius)
    .style("fill", (d, i) => d.imageUrl ? `url(#img-${i})` : d.fallbackColor)
    .style("stroke", "rgba(255,255,255,0.18)").style("stroke-width", 1.5)
    .on("mouseover", function(d) {
      d3.select(this).transition().duration(200).attr("r", d.radius * 1.1);
      tooltip.style("visibility", "visible").text(`${d.name}: ${d.playcount} plays`);
    })
    .on("mousemove", function() {
      const r = bubbleChart.getBoundingClientRect();
      tooltip.style("top",  `${d3.event.clientY - r.top  - 10}px`)
             .style("left", `${d3.event.clientX - r.left + 14}px`);
    })
    .on("mouseout", function(d) {
      d3.select(this).transition().duration(200).attr("r", d.radius);
      tooltip.style("visibility", "hidden");
    });

  const labels = svg.selectAll("text.fallback-label")
    .data(nodes.filter((d) => !d.imageUrl)).enter().append("text")
    .attr("class", "fallback-label")
    .attr("x", (d) => d.x).attr("y", (d) => d.y)
    .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
    .style("fill", "#fff").style("font-weight", "700").style("pointer-events", "none")
    .style("font-size", (d) => `${Math.max(10, Math.min(18, d.radius * 0.26))}px`)
    .text((d) => d.name);

  bubbleSimulation = d3.forceSimulation(nodes)
    .force("x", d3.forceX(W / 2).strength(preview ? 0.06 : 0.05))
    .force("y", d3.forceY(H / 2).strength(preview ? 0.06 : 0.05))
    .force("collide", d3.forceCollide().radius((d) => d.radius + 1))
    .on("tick", () => {
      circles.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
      labels.attr("x",  (d) => d.x).attr("y",  (d) => d.y);
    });

  bubbleSimulation.alpha(1).restart();

  circles.call(
    d3.drag()
      .on("start", (d) => {
        if (!d3.event.active) bubbleSimulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag",  (d) => { d.fx = d3.event.x; d.fy = d3.event.y; })
      .on("end",   (d) => {
        if (!d3.event.active) bubbleSimulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      })
  );
}

async function loadBubblePreview() {
  if (dashboard.hidden) return;
  try {
    const period = bubblePeriod.value || "12month";
    const res  = await apiFetch(
      `/api/custom/top-artists?period=${encodeURIComponent(period)}&limit=5`,
      { credentials: "include" }
    );
    const data = await res.json();
    if (!res.ok || !data.artists?.length) return;
    bubbleCardWrap.classList.remove("bubble-card--built", "bubble-card--expanded");
    btnBubbleExpand.hidden = true;
    await renderBubbleChart(data.artists.slice(0, 5), { preview: true });
  } catch (_) {}
}

function clearBubbleChart() {
  stopBubbleSimulation();
  bubbleChart.innerHTML = "";
  bubbleChart.style.minHeight = "";
  bubbleCardWrap.classList.remove("bubble-card--built", "bubble-card--expanded");
  btnBubbleExpand.hidden = true;
}

// ── Bubble chart — full expand toggle ────────────────────────────────────────
let bubbleExpanded = false;

btnBubbleExpand.addEventListener("click", () => {
  bubbleExpanded = !bubbleExpanded;
  bubbleCardWrap.classList.toggle("bubble-card--expanded", bubbleExpanded);
  btnBubbleExpand.textContent = bubbleExpanded ? "⊠ Collapse" : "⤢ Full Display";
});

// ── Bubble chart — build ──────────────────────────────────────────────────────
btnBubbleLoad.addEventListener("click", async () => {
  const period = bubblePeriod.value;
  const count  = clamp(parseInt(bubbleCount.value, 10) || 50, 5, 200);

  // Reset state
  bubbleExpanded = false;
  bubbleCardWrap.classList.remove("bubble-card--expanded", "bubble-card--built");
  btnBubbleExpand.textContent = "⤢ Full Display";
  btnBubbleExpand.hidden = true;
  stopBubbleSimulation();
  bubbleChart.innerHTML  = "";
  bubbleChart.style.minHeight = "";
  bubbleCardWrap.classList.add("bubble-card--built");

  try {
    const res  = await apiFetch(
      `/api/custom/top-artists?period=${encodeURIComponent(period)}&limit=${count}`,
      { credentials: "include" }
    );
    const data = await res.json();
    if (!res.ok) {
      bubbleCardWrap.classList.remove("bubble-card--built");
      await loadBubblePreview();
      showError(data.error || "Request failed");
      return;
    }

    const artists = (data.artists || []).slice(0, count);
    if (!artists.length) {
      bubbleCardWrap.classList.remove("bubble-card--built");
      await loadBubblePreview();
      showError("No artists returned for that period.");
      return;
    }

    await renderBubbleChart(artists);
    btnBubbleExpand.hidden = false;

  } catch (e) {
    bubbleCardWrap.classList.remove("bubble-card--built");
    await loadBubblePreview();
    showError(e.message);
  }
});

// Clamp bubble count on blur (min 5, max 200)
bubbleCount.addEventListener("blur", () => {
  const v = parseInt(bubbleCount.value, 10);
  if (isNaN(v) || v < 5)  bubbleCount.value = 5;
  if (v > 200)            bubbleCount.value = 200;
});

// ── Boot ──────────────────────────────────────────────────────────────────────
ensureApiLoadingOverlay();
checkAuth();
