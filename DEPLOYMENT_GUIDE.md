# Deployment

Production runs on Vercel (project `mun`, region `fra1`, next to the Neon database in `eu-central-1`) at https://www.miumunal.org. Deploys are made from the CLI (`vercel deploy --prod`); automatic Git deployments are off in `vercel.json`.

## Release checklist

1. `npm run build`, `npm run typecheck`, `npm test` (and the browser checks with `MUN_BROWSER=1`) pass locally; CI must be green.
2. Schema changes are additive. Apply them before deploying code that uses them: `npm run db:migrate:deploy` with `DIRECT_DATABASE_URL`.
3. `vercel deploy --prod`, then check `/api/v1/health/ready`, sign-in, and the page you changed on https://www.miumunal.org.
4. Roll back from the Vercel dashboard (promote the previous deployment). Keep added tables and columns; fix forward if the schema moved on.

## Environment (Vercel → Production)

Use [.env.vercel.example](.env.vercel.example) as the list. Secrets (database URL, Google secret, API keys, Cloudinary secret, OneSignal keys, `CRON_SECRET`) are stored as sensitive values. Changes apply to new deployments.

- `APP_ORIGIN=https://www.miumunal.org`, `GOOGLE_CALLBACK_URL=https://www.miumunal.org/api/auth/google/callback`.
- Locally, keep `APP_ORIGIN=http://localhost:3000` and the localhost callback.

## Domains

`miumunal.org` redirects to `www` (Vercel domain settings) and `mun-smoky.vercel.app` redirects to `www` (`vercel.json`). The Google OAuth client must list the `www` callback, and OneSignal's web configuration must use `https://www.miumunal.org` as its site URL.

## Push notifications (OneSignal)

- Needs `ONESIGNAL_APP_ID`, `ONESIGNAL_SAFARI_WEB_ID`, `ONESIGNAL_REST_API_KEY` (from API keys), `ONESIGNAL_IDENTITY_PRIVATE_KEY_BASE64` (the Identity Verification private key, base64 PEM) with `ONESIGNAL_IDENTITY_VERIFIED=true` and the dashboard's Token Identity Verification turned on, plus `PUSH_ENABLED=true`, `PUSH_MODE=members`, `PUSH_AUDIENCE_APPROVED=true` and `CRON_SECRET`.
- The page asks for permission after sign-in. The OneSignal worker is served at `/push/onesignal/OneSignalSDKWorker.js` (scope `/push/onesignal/`); the app's own worker stays at `/`.
- Notifications are queued with the inbox event, sent on the next write, and the daily Vercel cron (`/api/cron/push`) drains the rest and announces the Daily Quiz.

## Provider notes

- Vercel Hobby is for personal, noncommercial use; confirm the club's eligibility. [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- Gemini stays disabled in production (its terms exclude apps likely used by under-18s). Groq requires an 18+ operator and suitable downstream use. [Gemini terms](https://ai.google.dev/gemini-api/terms) · [Groq agreement](https://console.groq.com/docs/legal/services-agreement)
- Free Cloudinary accounts block public PDF links, so resource PDFs open through `/api/resource-file` (signed-in members, 10-minute signed download).
- Neon's free compute sleeps when idle; the first request after a pause is slower.
