# Deployment and rollback

The existing GitHub commit and the current working tree are different versions. Deploy this branch only to a review-approved isolated environment after local checks.

1. Create a separate, empty or anonymized Neon staging branch. Set its pooled URL as `DATABASE_URL` and its direct URL as `DIRECT_DATABASE_URL` in server secrets. Keep credentials outside Git.
2. Review `schema.sql` against the destination and confirm a restore point. Run `npm run db:migrate:deploy` with the isolated direct URL. Run `npm start` for a local smoke test. The application exports Express from `server.mjs` for the Vercel preset.
3. Use the exact preview origin in `APP_ORIGIN`, and configure the Google consent app and authorized callback at that origin followed by `/auth/google/callback`. Use authorized test accounts, including the configured board owner. Keep AI disabled for preview.
4. Check health endpoints, static asset MIME types, Chrome install behavior, Google callback and sign-out, board approval, and member workflows on the deployed preview before considering release.
5. Confirm repository visibility, branch protection, provider conditions and board approvals before enabling automatic deployments or promoting a build. The repository configuration requests disabled automatic Git deployments during development.

Rollback the app to a previous known-good version only after checking schema compatibility. Keep additive tables in place. If compatibility fails, prefer forward repair and test it against a restored staging copy before changing production.

## Provider eligibility

- Vercel's Hobby documentation limits the tier to personal noncommercial use. Confirm eligibility for the club with the account owner and provider before preview deployment. [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- Gemini terms prohibit use in apps likely to be accessed by under-18 users. Gemini is excluded from live provider selection here. GroqCloud has an 18+ customer requirement. Any Groq deployment needs a qualified organization operator and confirmation that downstream use, model terms and privacy are suitable. [Gemini terms](https://ai.google.dev/gemini-api/terms) · [Groq Services Agreement](https://console.groq.com/docs/legal/services-agreement) · [Groq rate limits](https://console.groq.com/docs/rate-limits)
- OneSignal advertises a free tier for organizations. Subscription/delivery quotas, secure identity features and age/data terms still need plan-specific verification. [OneSignal pricing](https://onesignal.com/pricing)
- Actual GitHub Actions and Neon usage, remaining quotas, backup retention, e-mail and storage provider eligibility need review before rollout.
