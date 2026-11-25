# MIU MUN & Arab League portal

Run from this directory with Node.js 24 or newer and a Neon Postgres database. The server serves the interface and API from the same origin.

1. Run `npm ci`. Copy `.env.example` to `.env` if needed, then set `DATABASE_URL` to the pooled connection string from Neon. Leave `APP_ORIGIN=http://localhost:3000` for local use.
2. In [Google Cloud](https://console.cloud.google.com/auth/clients), add `http://localhost:3000/api/auth/google/callback` under **Authorized redirect URIs**. If the app is in Testing mode, add the Google accounts that will test it.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` locally in `.env`. Set `GOOGLE_CALLBACK_URL` when overriding the default callback. First login registers a pending member for board approval. A trusted database operator can explicitly provision the first President using `npm run admin:provision-president -- VERIFIED_GOOGLE_SUBJECT` after reviewing the pending account and target environment. An existing active President prevents this operation.
4. Run `npm.cmd start` in PowerShell or `npm start` on other shells. Open [http://localhost:3000](http://localhost:3000).

Apply schema changes explicitly to an isolated database using `DIRECT_DATABASE_URL` and `npm run db:migrate:deploy`. Existing data stays in the `mun_` tables. To add starter learning links and quiz questions to an isolated development database, run the server with `MUN_SEED=true`.

The assistant serves prepared answers and official links by default. External generation remains subject to the organization's provider and privacy approval. See [deployment and provider eligibility](DEPLOYMENT_GUIDE.md).

## Deploy

Use a Node host with HTTPS. Build with `npm ci --omit=dev` and run `npm start`. Set `HOST=0.0.0.0`, `APP_ORIGIN` to the public HTTPS origin, and supply `DATABASE_URL` and credentials through the host's secret settings. Add the HTTPS origin followed by `/api/auth/google/callback` as another exact Google redirect URI. For a club-wide rollout, configure the Google OAuth audience for the intended users.

Run integration checks with `npm.cmd test` or `npm test`. The tests use an isolated Postgres instance in memory and signed fixture Google responses.
