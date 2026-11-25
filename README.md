# MIU MUN & Arab League portal

The member portal of MIU Model United Nations & Model Arab League (MIU-MUNAL), live at https://www.miumunal.org. One Node.js server (Express) serves the page and the API; data lives in Neon Postgres.

## Run locally

1. Node.js 24 or newer. Run `npm ci`.
2. Copy `.env.example` to `.env`, set `DATABASE_URL` (Neon pooled connection string), `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Keep `APP_ORIGIN=http://localhost:3000`, and add `http://localhost:3000/api/auth/google/callback` as a redirect URI on the Google OAuth client.
3. `npm start` (PowerShell: `npm.cmd start`), then open http://localhost:3000.

Optional features turn on when their keys are set: Cloudinary (profile photos and resource PDFs), Groq (AI assistant with Wikipedia sources) and OneSignal (push notifications). See `.env.example`.

## How membership works

- Club members come from the roster (imported from the membership sheet with `importRoster`). A listed university email is activated on first Google sign-in with its name, role, committee and position. Anyone else waits for the board.
- Roles, highest first: President, Co-President, Upper Board, High Board / Vice President, Head, then Member and custom roles. You can only grant roles below your own and only edit accounts below yours. A Head manages only their own committee.
- The first President is provisioned once with `npm run admin:provision-president -- GOOGLE_SUBJECT`.

## Project layout

- `server.mjs`: HTTP routes, sign-in, permissions, and all reads and writes.
- `database.mjs`, `schema.sql`, `migrate.mjs`: Postgres access and the additive schema (`npm run db:migrate:deploy` with `DIRECT_DATABASE_URL`).
- `assistant-providers.mjs`: Groq and Gemini calls for the assistant. `onesignal.mjs`: push delivery.
- `dist/`: the page (`index.html`, `app.js`, `style.css`), the service worker and icons.
- `test/`: integration tests (in-memory Postgres, fixture Google, Cloudinary, AI and OneSignal responses) and browser checks.

## Checks

`npm run build`, `npm run typecheck` and `npm test`. Browser checks run with `MUN_BROWSER=1` (set `MUN_CHROMIUM_PATH` to use an installed Chrome or Edge). CI runs all of them on every push.

Deployment, domains and external dashboards: see [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).
