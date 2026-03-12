# Last.fm Custom Web App

A small web app that connects to the [Last.fm API](https://www.last.fm/api) so you can add features the main Last.fm site doesn’t offer. Your API secret stays on the server; the frontend talks only to your backend.

## Setup

1. **Get API credentials**  
   Create an app at [last.fm/api/account/create](https://www.last.fm/api/account/create). Set the callback URL to your app (e.g. `http://localhost:3000/auth/callback`).

2. **Clone and install**
   ```bash
   cd lastfm-webapp
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set:
   - `LASTFM_API_KEY` – your 32-character API key  
   - `LASTFM_API_SECRET` – your API secret  
   - `BASE_URL` – e.g. `http://localhost:3000` (must match the callback URL you registered)  
   - `SESSION_SECRET` – any random string for session signing  

4. **Run**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000`, log in with Last.fm, and use the dashboard.

## What’s included

- **Login** – Web auth flow: redirect to Last.fm → callback → session stored in cookies.
- **Public proxy** – `GET /api/lastfm?method=...&user=...` for any read-only Last.fm method (no auth).
- **Authenticated proxy** – `GET/POST /api/lastfm/auth?method=...` for methods that need a session key (e.g. scrobbling, love, etc.).
- **Custom tools**
  - **Export recent tracks** – `GET /api/custom/recent-export?limit=200` – returns JSON and the UI offers a download.
  - **Top artists** – `GET /api/custom/top-artists?period=12month` – top artists for a period.
- **Raw API** – From the UI you can call any method (e.g. `user.getRecentTracks`) with optional `user`.

## Adding your own functions

- **New read-only feature**: Add a route in `server.js` that calls `lastfmGet({ method: "package.method", api_key, ...params })` and returns the result (or transform it).
- **New write feature** (e.g. scrobble, love): Use `lastfmPost({ method, api_key, sk, ...params })` in an authenticated route; ensure the user is logged in and use `req.session.lastfmSessionKey` as `sk`.
- **New UI**: Add a card in `public/index.html`, hook it in `public/app.js` to call your new backend route.

API method list: [Last.fm API docs](https://www.last.fm/api/intro) (menu on the left).

## Security notes

- Do not expose `LASTFM_API_SECRET` to the browser. All signed/write calls go through your server.
- In production use HTTPS, a strong `SESSION_SECRET`, and consider a proper session store (e.g. Redis).
