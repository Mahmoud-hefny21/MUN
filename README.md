# MIU MUN & Arab League portal

Run from this directory with Node.js 24 or newer and a Neon Postgres database. The server serves the interface and API from the same origin.

1. Run `npm ci`. Copy `.env.example` to `.env` if needed, then set `DATABASE_URL` to the pooled connection string from Neon. Leave `APP_ORIGIN=http://localhost:3000` for local use.
2. In [Google Cloud](https://console.cloud.google.com/auth/clients), configure the OAuth consent screen and create a **Web application** client. Add `http://localhost:3000/auth/google/callback` under **Authorized redirect URIs**. If the app is in Testing mode, add the Google accounts that will test it.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `BOARD_OWNER_EMAIL` in `.env`. The board owner must sign in with that verified Google account. New Google users otherwise get the Member role. The board owner can change roles and deactivate accounts.
4. Run `npm.cmd start` in PowerShell or `npm start` on other shells. Open [http://localhost:3000](http://localhost:3000).

The server initializes the `mun_` tables on startup and adds official learning links, templates and a small quiz bank. The board adds club updates and other material. Members, feed, votes and points are stored in Neon.

To enable generated answers, set `OPENAI_API_KEY` and `OPENAI_MODEL`. The assistant sends the member's question and relevant library excerpts to the API. With those variables unset it serves prepared answers and official links.

## Deploy

Use a Node host with HTTPS. Build with `npm ci --omit=dev` and run `npm start`. Set `HOST=0.0.0.0`, `APP_ORIGIN` to the public HTTPS origin, and supply `DATABASE_URL` and credentials through the host's secret settings. Add the HTTPS origin followed by `/auth/google/callback` as another exact Google redirect URI. For a club-wide rollout, configure the Google OAuth audience for the intended users.

Run integration checks with `npm.cmd test` or `npm test`. The tests use an isolated Postgres instance in memory and signed fixture Google responses.
