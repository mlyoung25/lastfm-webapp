# Last.fm+

A fan-made web app for exploring your [Last.fm](https://www.last.fm/) listening history. Your API secret stays on the server; the browser only talks to your backend.

**Live demo:** [lastfm-webapp.onrender.com](https://lastfm-webapp.onrender.com)

## Features

- **Top Artists** — ranked list for any time period (7 days → overall)
- **Top Tracks by Artist** — your most-played tracks for one artist, with fallback scrobble scanning
- **Bubble Chart** — D3 force chart sized by playcount; preview, build, drag, and fullscreen modal
- **First Listen** — find the earliest scrobble for an artist or a specific track
- **Now Playing** — live hero card when you're actively scrobbling
- **Export** — download recent scrobbles as JSON
- **Raw API** — call any read-only Last.fm method from the UI

Enter a Last.fm username to get started (no OAuth required for read-only tools). Full Last.fm OAuth is available on the server for future write features.

## Local setup

1. **Get API credentials** at [last.fm/api/account/create](https://www.last.fm/api/account/create). Set the callback URL to `http://localhost:3000/auth/callback`.

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Required in `.env`:
   - `LASTFM_API_KEY` — 32-character API key
   - `LASTFM_API_SECRET` — API secret
   - `BASE_URL` — `http://localhost:3000` (must match your Last.fm callback URL)
   - `SESSION_SECRET` — any random string for signing cookies

   Optional:
   - `REDIS_URL` — Redis connection URL for persistent sessions (recommended if you test deploy-like behavior locally)

4. **Run**
   ```bash
   pnpm dev
   ```
   Opens [http://localhost:3000](http://localhost:3000). Enter a Last.fm username on the hero form.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LASTFM_API_KEY` | Yes | Last.fm API key |
| `LASTFM_API_SECRET` | Yes | Last.fm API secret (server only) |
| `BASE_URL` | Production | Public URL, e.g. `https://lastfm-webapp.onrender.com` |
| `SESSION_SECRET` | Production | Long random string for session signing |
| `REDIS_URL` | Recommended | Redis URL for session storage (see below) |
| `NODE_ENV` | Auto on Render | `development` locally, `production` on Render |
| `PORT` | No | Defaults to `3000` |

## Deploy on Render

1. Push this repo to GitHub.
2. Create a **Web Service** on [Render](https://render.com) from the repo (or use the included `render.yaml`).
3. Set environment variables in the Render dashboard:
   - `LASTFM_API_KEY`
   - `LASTFM_API_SECRET`
   - `BASE_URL` = your Render URL, e.g. `https://lastfm-webapp.onrender.com`
   - `SESSION_SECRET` = long random string
   - `REDIS_URL` = Redis connection URL (see **Redis sessions** below)
4. Deploy and verify: `GET /healthz` → `{ "ok": true }`
5. In your Last.fm API app settings, set the callback URL to:
   `https://your-service.onrender.com/auth/callback`

### Keep-alive (free tier)

Render's free plan spins down after ~15 minutes of idle time. A GitHub Actions workflow (`.github/workflows/keep-alive.yml`) pings `/healthz` every 5 minutes to reduce cold starts. After pushing, confirm it runs under **Actions → Keep Render awake**. Optionally set a `RENDER_APP_URL` repo secret if your URL differs from the default.

### Redis sessions

By default, `express-session` stores sessions in memory — they are **lost on every deploy or restart**. For production, set `REDIS_URL` to a Redis instance.

**Upstash (free tier, recommended):**

1. Create a database at [upstash.com](https://upstash.com)
2. Copy the **Redis URL** (`rediss://…`)
3. Add it as `REDIS_URL` in Render (and locally in `.env` if desired)

Without `REDIS_URL`, the app still runs but logs a warning and uses in-memory sessions.

## API overview

| Route | Auth | Description |
|-------|------|-------------|
| `GET /api/lastfm?method=…` | No | Public Last.fm proxy (read-only) |
| `GET/POST /api/lastfm/auth` | Session | Authenticated Last.fm proxy |
| `GET /api/custom/top-artists` | Username | Top artists for a period |
| `GET /api/custom/top-tracks-by-artist` | Username | Top tracks for one artist |
| `GET /api/custom/first-listen` | Username | Earliest scrobble for artist/track |
| `GET /api/custom/now-playing` | Username | Currently scrobbling track |
| `GET /api/custom/recent-export` | Username | Recent tracks as JSON |
| `POST /api/session/username` | No | Set username for read-only session |
| `GET /auth/login` | No | Last.fm OAuth redirect |
| `GET /healthz` | No | Health check |

Last.fm API method list: [last.fm/api/intro](https://www.last.fm/api/intro)

## Adding your own features

- **New read-only tool:** Add a route in `server.js` that calls `lastfmGet({ method, api_key, … })`, then wire a card in `public/index.html` and handler in `public/app.js`.
- **New write feature** (scrobble, love, etc.): Use `lastfmPost` with `req.session.lastfmSessionKey` in an authenticated route.
- **New UI:** Follow the existing card + results panel pattern in the dashboard.

## Testing

First Listen accuracy can be validated against a local export file:

```bash
pnpm dev   # in one terminal
pnpm test  # in another — picks random artists by default
```

See `tests/test-first-listen.js` for usage (`LASTFM_USER`, `SESSION_COOKIE`, specific artist args).

## Production notes

- **Security:** Helmet (CSP), compression, and rate limiting on `/api/*` and `/auth/*`. API secret never sent to the browser.
- **Caching:** In-memory TTL cache for Last.fm responses (tuned per method in `server.js`).
- **SEO:** Meta tags, Open Graph, JSON-LD, `/robots.txt`, `/sitemap.xml`, cache-busted static assets.
- **Attribution:** Not affiliated with Last.fm. Powered-by link in the site footer.

## Project structure

```
lastfm-webapp/
├── server.js           # Express API, auth, Last.fm proxy, custom routes
├── public/
│   ├── index.html      # App shell
│   ├── app.js          # Frontend logic
│   └── styles.css      # Styles
├── tests/              # First Listen validation script
├── render.yaml         # Render deploy config
└── .github/workflows/  # Keep-alive ping for Render free tier
```
