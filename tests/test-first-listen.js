#!/usr/bin/env node
/**
 * Validates /api/custom/first-listen against the local export JSON.
 *
 * Usage:
 *   node test-first-listen.js                          # picks 3 random artists
 *   node test-first-listen.js "Laufey"                 # specific artist
 *   node test-first-listen.js "Laufey" "MGMT"          # multiple artists
 *   node test-first-listen.js "Bladee|Hotel Breakfast" # artist + track (pipe-separated)
 *
 * Requires the dev server to be running at http://localhost:3000.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "realdatatestfile.json"); // tests/realdatatestfile.json
const BASE_URL = process.env.SERVER_URL || "http://localhost:3000";
const LASTFM_USER = process.env.LASTFM_USER || "globyglob";
const SESSION_COOKIE = process.env.SESSION_COOKIE || "";

// ── Parse Timestamp strings like "22 Nov 2019 04:31" ────────────────────────
const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function parseTimestamp(ts) {
  const [day, mon, year, time] = ts.split(" ");
  const [h, m] = time.split(":").map(Number);
  return new Date(Date.UTC(+year, MONTHS[mon], +day, h, m)).getTime() / 1000;
}

function normalize(s) {
  return String(s ?? "").toLowerCase().trim();
}

// ── Load and index the export file ──────────────────────────────────────────
console.log("Loading export JSON …");
const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
console.log(`Loaded ${raw.length.toLocaleString()} scrobbles.\n`);

const byArtist = new Map();
for (const entry of raw) {
  if (!entry.Timestamp || entry.Timestamp.split(" ").length < 4) continue;
  const key = normalize(entry.Artist);
  if (!byArtist.has(key)) byArtist.set(key, []);
  byArtist.get(key).push({
    artist: String(entry.Artist),
    track: String(entry.Track),
    album: String(entry.Album),
    timestamp: entry.Timestamp,
    epoch: parseTimestamp(entry.Timestamp),
  });
}

// Ground truth for artist (optionally filtered to a specific track).
function groundTruth(artistQuery, trackQuery = null) {
  const artistKey = normalize(artistQuery);
  let plays = byArtist.get(artistKey);
  if (!plays || plays.length === 0) return null;
  if (trackQuery) {
    const trackKey = normalize(trackQuery);
    plays = plays.filter((p) => normalize(p.track) === trackKey);
    if (plays.length === 0) return null;
  }
  return plays.reduce((min, p) => (p.epoch < min.epoch ? p : min));
}

// ── Call the server ──────────────────────────────────────────────────────────
async function apiFirstListen(artist, track = null) {
  let url = `${BASE_URL}/api/custom/first-listen?user=${encodeURIComponent(LASTFM_USER)}&artist=${encodeURIComponent(artist)}`;
  if (track) url += `&track=${encodeURIComponent(track)}`;
  const headers = { "Content-Type": "application/json" };
  if (SESSION_COOKIE) headers["Cookie"] = SESSION_COOKIE;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Test one artist (+ optional track) ──────────────────────────────────────
async function testEntry(artist, track = null) {
  const label = track ? `"${artist}" — "${track}"` : `"${artist}"`;
  const truth = groundTruth(artist, track);
  if (!truth) {
    console.log(`⚠  ${label} — NOT FOUND in local export.\n`);
    return;
  }

  console.log(`Testing: ${label}`);
  console.log(`  Ground truth : ${truth.timestamp}  →  "${truth.track}"`);

  let result;
  try {
    result = await apiFirstListen(artist, track);
  } catch (e) {
    console.log(`  API error    : ${e.message}\n`);
    return;
  }

  if (!result.found) {
    console.log(`  API result   : NOT FOUND — ${result.message}`);
    console.log(`  ✗ MISMATCH (API says not found, local has ${truth.timestamp})\n`);
    return;
  }

  const fl = result.firstListen;
  console.log(`  API result   : ${fl.date}  →  "${fl.track}"`);

  const delta = Math.abs(fl.timestamp - truth.epoch);
  if (delta <= 120) {
    console.log(`  ✓ MATCH  (Δ ${delta}s)\n`);
  } else {
    const truthDate = new Date(truth.epoch * 1000).toUTCString();
    const apiDate   = new Date(fl.timestamp  * 1000).toUTCString();
    console.log(`  ✗ MISMATCH`);
    console.log(`      Local  : ${truthDate}  — "${truth.track}"`);
    console.log(`      API    : ${apiDate}  — "${fl.track}"`);
    console.log(`      Δ = ${Math.round(delta / 3600)} hours off\n`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
// Each CLI arg is either "Artist" or "Artist|Track name"
const cliArgs = process.argv.slice(2);

let entries; // array of [artist, track|null]
if (cliArgs.length > 0) {
  entries = cliArgs.map((arg) => {
    const pipe = arg.indexOf("|");
    if (pipe !== -1) return [arg.slice(0, pipe).trim(), arg.slice(pipe + 1).trim()];
    return [arg.trim(), null];
  });
} else {
  const keys = [...byArtist.keys()];
  const picks = new Set();
  while (picks.size < Math.min(3, keys.length)) {
    picks.add(keys[Math.floor(Math.random() * keys.length)]);
  }
  entries = [...picks].map((k) => [byArtist.get(k)[0].artist, null]);
  console.log("No args — picked at random:", entries.map(([a]) => a), "\n");
}

for (const [artist, track] of entries) {
  await testEntry(artist, track);
}
