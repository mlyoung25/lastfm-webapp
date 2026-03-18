//app.js

const usernameEl = document.getElementById("username");
const btnLogin = document.getElementById("btnLogin");
const btnLogout = document.getElementById("btnLogout");
const welcome = document.getElementById("welcome");
const dashboard = document.getElementById("dashboard");
const errorBanner = document.getElementById("error");

const recentLimit = document.getElementById("recentLimit");
const btnRecentExport = document.getElementById("btnRecentExport");
const recentPreview = document.getElementById("recentPreview");

const topPeriod = document.getElementById("topPeriod");
const btnTopArtists = document.getElementById("btnTopArtists");
const topPreview = document.getElementById("topPreview");
const topArtistsResults = document.getElementById("topArtistsResults");
const topArtistsMeta = document.getElementById("topArtistsMeta");
const topArtistsList = document.getElementById("topArtistsList");

const rawMethod = document.getElementById("rawMethod");
const rawUser = document.getElementById("rawUser");
const btnRaw = document.getElementById("btnRaw");
const rawPreview = document.getElementById("rawPreview");

const artistFromTop = document.getElementById("artistFromTop");
const artistSearch = document.getElementById("artistSearch");
const tracksByArtistPeriod = document.getElementById("tracksByArtistPeriod");
const btnTopTracksByArtist = document.getElementById("btnTopTracksByArtist");
const tracksByArtistResults = document.getElementById("tracksByArtistResults");
const tracksByArtistMeta = document.getElementById("tracksByArtistMeta");
const tracksByArtistList = document.getElementById("tracksByArtistList");
const tracksByArtistPreview = document.getElementById("tracksByArtistPreview");

const bubblePeriod = document.getElementById("bubblePeriod");
const bubbleCount = document.getElementById("bubbleCount");
const btnBubbleLoad = document.getElementById("btnBubbleLoad");
const bubbleChart = document.getElementById("bubbleChart");
let apiRequestsInFlight = 0;
let apiLoadingOverlay = null;

function ensureApiLoadingOverlay() {
  if (apiLoadingOverlay) return apiLoadingOverlay;
  const overlay = document.createElement("div");
  overlay.className = "api-loading-overlay";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="api-loading-spinner-wrap">
      <div class="api-loading-spinner" aria-hidden="true"></div>
      <div class="api-loading-text">Loading...</div>
    </div>
  `;
  document.body.appendChild(overlay);
  apiLoadingOverlay = overlay;
  return overlay;
}

function setApiLoading(active) {
  const overlay = ensureApiLoadingOverlay();
  overlay.classList.toggle("visible", active);
  document.body.classList.toggle("is-api-loading", active);
}

function isApiRequest(input) {
  const inputUrl = typeof input === "string" ? input : input?.url || "";
  if (!inputUrl) return false;
  const url = new URL(inputUrl, window.location.origin);
  return (
    url.origin === window.location.origin &&
    (url.pathname.startsWith("/api/") || url.pathname === "/auth/logout")
  );
}

async function apiFetch(input, init) {
  const trackLoading = isApiRequest(input);
  if (trackLoading) {
    apiRequestsInFlight += 1;
    setApiLoading(true);
  }
  try {
    return await fetch(input, init);
  } finally {
    if (trackLoading) {
      apiRequestsInFlight = Math.max(0, apiRequestsInFlight - 1);
      setApiLoading(apiRequestsInFlight > 0);
    }
  }
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.hidden = false;
  setTimeout(() => { errorBanner.hidden = true; }, 5000);
}

function showPreview(el, data) {
  el.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  el.style.display = "block";
}

async function checkAuth() {
  try {
    const res = await apiFetch("/api/me", { credentials: "include" });
    const data = await res.json();
    if (data.username) {
      usernameEl.textContent = data.username;
      btnLogin.hidden = true;
      btnLogout.hidden = false;
      welcome.hidden = true;
      dashboard.hidden = false;
      loadTopArtistsForPicker();
      return data.username;
    }
  } catch (_) {}
  usernameEl.textContent = "";
  btnLogin.hidden = false;
  btnLogout.hidden = true;
  welcome.hidden = false;
  dashboard.hidden = true;
  return null;
}

// Show ?error= from callback
const params = new URLSearchParams(location.search);
const err = params.get("error");
if (err) {
  showError(decodeURIComponent(err));
  history.replaceState({}, "", location.pathname);
}

btnLogin.addEventListener("click", () => {
  window.location.href = "/auth/login";
});

btnLogout.addEventListener("click", async () => {
  await apiFetch("/auth/logout", { method: "POST", credentials: "include" });
  await checkAuth();
});

btnRecentExport.addEventListener("click", async () => {
  const limit = recentLimit.value || 50;
  try {
    const res = await apiFetch(
      `/api/custom/recent-export?limit=${encodeURIComponent(limit)}`,
      { credentials: "include" }
    );
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || "Request failed");
      return;
    }
    showPreview(recentPreview, data);
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lastfm-recent-${data.user}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    showError(e.message);
  }
});

btnTopArtists.addEventListener("click", async () => {
  const period = topPeriod.value;
  try {
    const res = await apiFetch(
      `/api/custom/top-artists?period=${encodeURIComponent(period)}`,
      { credentials: "include" }
    );
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || "Request failed");
      return;
    }
    showPreview(topPreview, data);
    populateArtistDropdown(data.artists || []);

    const artists = data.artists || [];
    topArtistsList.innerHTML = "";
    topArtistsMeta.textContent = artists.length
      ? `Your top ${artists.length} artist${artists.length !== 1 ? "s" : ""} (${period}).`
      : "No top artists found for that period.";
    artists.forEach((a) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "artist-name";
      name.textContent = a.name ?? a["#text"] ?? "";
      const playcount = document.createElement("span");
      playcount.className = "track-playcount";
      const pc = parseInt(a.playcount, 10) || 0;
      playcount.textContent = `${pc} play${pc !== 1 ? "s" : ""}`;
      li.appendChild(name);
      li.appendChild(playcount);
      if (a.url) {
        const link = document.createElement("a");
        link.className = "track-url";
        link.href = a.url;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "Last.fm";
        li.appendChild(link);
      }
      topArtistsList.appendChild(li);
    });
    topArtistsResults.hidden = false;
  } catch (e) {
    showError(e.message);
  }
});

btnRaw.addEventListener("click", async () => {
  const method = rawMethod.value.trim();
  if (!method) {
    showError("Enter a method (e.g. user.getRecentTracks)");
    return;
  }
  const user = rawUser.value.trim();
  const q = new URLSearchParams({ method });
  if (user) q.set("user", user);
  try {
    const res = await apiFetch(`/api/lastfm?${q}`, { credentials: "include" });
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || "Request failed");
      return;
    }
    showPreview(rawPreview, data);
  } catch (e) {
    showError(e.message);
  }
});

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur], cur);
    }
  });
  await Promise.all(workers);
  return results;
}

async function getArtistImageUrl(artistName) {
  try {
    const res = await apiFetch(`/api/artist-image-proxy?artist=${encodeURIComponent(artistName)}`);
    const data = await res.json();
    return data.imageUrl; // Returns the base64 string
  } catch (err) {
    console.error(err);
    return null;
  }
}

btnBubbleLoad.addEventListener("click", async () => {
  const period = bubblePeriod.value;
  const count = clamp(parseInt(bubbleCount.value, 10) || 50, 5, 50);
  bubbleChart.innerHTML = "";

  try {
    const res = await apiFetch(
      `/api/custom/top-artists?period=${encodeURIComponent(period)}&limit=50`,
      { credentials: "include" }
    );
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || "Request failed");
      return;
    }

    const artists = (data.artists || []).slice(0, count);
    if (artists.length === 0) {
      showError("No artists returned for that period.");
      return;
    }

    const playcounts = artists.map((a) => parseInt(a.playcount, 10) || 0);
    const maxPlaycount = Math.max(...playcounts, 1);
    const minPlaycount = Math.max(Math.min(...playcounts), 1);
    const ratio = minPlaycount / maxPlaycount;

    let maxBubbleSize;
    if (ratio > 1 / 10) maxBubbleSize = 150;
    else if (ratio > 1 / 20) maxBubbleSize = 180;
    else if (ratio > 1 / 40) maxBubbleSize = 210;
    else if (ratio > 1 / 50) maxBubbleSize = 250;
    else if (ratio > 1 / 70) maxBubbleSize = 300;
    else maxBubbleSize = 400;

    const W = 1600;
    const H = 1200;

    const nodes = artists.map((a) => {
      const pc = parseInt(a.playcount, 10) || 0;
      const pcRatio = pc / maxPlaycount;
      const radius = Math.max(30, (pcRatio ** (1 / 1.2)) * maxBubbleSize * 0.5) * 2;
      const name = a.name ?? a["#text"] ?? "";
      const hueSeed = Array.from(name).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;
      return {
        name,
        playcount: pc,
        radius,
        x: W / 2 + (Math.random() - 0.5) * 80,
        y: H / 2 + (Math.random() - 0.5) * 80,
        imageUrl: null,
        fallbackColor: `hsl(${hueSeed}, 58%, 42%)`,
      };
    });

    // Build SVG
    const svg = d3.select("#bubbleChart")
      .append("svg")
      .attr("viewBox", `0,0,${W},${H}`)
      .attr("preserveAspectRatio", "xMinYMin meet")
      .style("font", "22px sans-serif");

    const defs = svg.append("defs");

    await Promise.all(nodes.map(async (node, index) => {
      node.imageUrl = await getArtistImageUrl(node.name);
      
      // Exact same pattern creation logic from your old Pug file
      if (node.imageUrl) {
        defs.append("pattern")
          .attr("id", "img-pattern-" + index)
          .attr("width", 1)
          .attr("height", 1)
          .append("image")
          .attr("xlink:href", node.imageUrl)
          .attr("width", node.radius * 2)
          .attr("height", node.radius * 2);
      }
    }));

    // Floating tooltip
    const tooltip = d3.select("#bubbleChart")
      .append("div")
      .attr("class", "bubble-tooltip");

    // Draw circles
    const circles = svg.selectAll("circle")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("class", "bubble")
      .attr("cx", (d) => d.x)
      .attr("cy", (d) => d.y)
      .attr("r", (d) => d.radius)
      .style("fill", (d, i) => (d.imageUrl ? `url(#img-pattern-${i})` : d.fallbackColor))
      .style("stroke", "rgba(255,255,255,0.18)")
      .style("stroke-width", 1.5)
      .on("mouseover", function(d) {
        d3.select(this).transition().duration(200).attr("r", d.radius * 1.1);
        tooltip.style("visibility", "visible").text(`${d.name}: ${d.playcount} plays`);
      })
      .on("mousemove", function() {
        const containerRect = bubbleChart.getBoundingClientRect();
        tooltip
          .style("top", `${d3.event.clientY - containerRect.top - 10}px`)
          .style("left", `${d3.event.clientX - containerRect.left + 14}px`);
      })
      .on("mouseout", function(d) {
        d3.select(this).transition().duration(200).attr("r", d.radius);
        tooltip.style("visibility", "hidden");
      });

    // Show readable artist names when image lookups fail.
    const fallbackLabels = svg.selectAll("text.fallback-label")
      .data(nodes.filter((d) => !d.imageUrl))
      .enter()
      .append("text")
      .attr("class", "fallback-label")
      .attr("x", (d) => d.x)
      .attr("y", (d) => d.y)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .style("fill", "#ffffff")
      .style("font-weight", "700")
      .style("pointer-events", "none")
      .style("font-size", (d) => `${Math.max(10, Math.min(18, d.radius * 0.26))}px`)
      .text((d) => d.name);

    // Force simulation
    const simulation = d3.forceSimulation(nodes)
      .force("x", d3.forceX(W / 2).strength(0.05))
      .force("y", d3.forceY(H / 2).strength(0.05))
      .force("collide", d3.forceCollide().radius((d) => d.radius + 1))
      .on("tick", () => {
        circles.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
        fallbackLabels.attr("x", (d) => d.x).attr("y", (d) => d.y);
      });

    // Drag
    circles.call(
      d3.drag()
        .on("start", (d) => {
          if (!d3.event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (d) => {
          d.fx = d3.event.x;
          d.fy = d3.event.y;
        })
        .on("end", (d) => {
          if (!d3.event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
    );

  } catch (e) {
    showError(e.message);
  }
});

function populateArtistDropdown(artists) {
  const sel = artistFromTop;
  const current = sel.value;
  sel.innerHTML = '<option value="">— Or type an artist below —</option>';
  (artists || []).forEach((a) => {
    const name = a.name ?? a["#text"] ?? "";
    if (!name) return;
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });
  if (current && artists.some((a) => (a.name ?? a["#text"]) === current)) {
    sel.value = current;
  }
}

async function loadTopArtistsForPicker() {
  try {
    const res = await apiFetch(
      "/api/custom/top-artists?period=12month&limit=50",
      { credentials: "include" }
    );
    const data = await res.json();
    if (res.ok && data.artists && data.artists.length > 0) {
      populateArtistDropdown(data.artists);
    }
  } catch (_) {}
}

btnTopTracksByArtist.addEventListener("click", async () => {
  const artist = artistSearch.value.trim() || artistFromTop.value || "";
  if (!artist) {
    showError("Choose an artist from the list or type an artist name.");
    return;
  }
  const period = tracksByArtistPeriod.value;
  try {
    const res = await apiFetch(
      `/api/custom/top-tracks-by-artist?artist=${encodeURIComponent(artist)}&period=${encodeURIComponent(period)}`,
      { credentials: "include" }
    );
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || "Request failed");
      return;
    }
    const tracks = data.tracks || [];
    tracksByArtistMeta.textContent = tracks.length
      ? `Your top ${tracks.length} track${tracks.length !== 1 ? "s" : ""} by ${data.artist} (${period}).`
      : `No tracks found for "${data.artist}" in your top tracks for this period. Try a different period or check the spelling.`;
    tracksByArtistList.innerHTML = "";
    tracks.forEach((t) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "track-name";
      name.textContent = t.name;
      const playcount = document.createElement("span");
      playcount.className = "track-playcount";
      playcount.textContent = `${t.playcount} play${t.playcount !== 1 ? "s" : ""}`;
      li.appendChild(name);
      li.appendChild(playcount);
      if (t.url) {
        const a = document.createElement("a");
        a.className = "track-url";
        a.href = t.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "Last.fm";
        li.appendChild(a);
      }
      tracksByArtistList.appendChild(li);
    });
    tracksByArtistResults.hidden = false;
    showPreview(tracksByArtistPreview, data);
  } catch (e) {
    showError(e.message);
  }
});

ensureApiLoadingOverlay();
checkAuth();
