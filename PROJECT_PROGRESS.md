# Project progress

## Baseline

- Read the V5 architecture, seven-page plan and 15-slide presentation. Compared the supplied emblem with the served emblem by SHA-256.
- The baseline at `578aae9` had a JavaScript portal, Neon via `pg`, OAuth Google and an isolated Postgres integration test. The test passed before edits. V5's React/Prisma design had no implementation in this checkout.

## Implemented in this development pass

1. Added an Express export, Zod-backed string validation, API health checks and an explicit schema application command. Kept the current data model and route compatibility.
2. Added approval for new Google members, protected board-controlled profile fields, and scoped committee posting, voting and inbox visibility. Added regression tests for permission changes and cross-committee isolation.
3. Added explicit Cairo-date quiz scheduling, configurable rewards, and source links. Added activities, attendance recording and history, atomic inbox fan-out and audit records for selected operations.
4. Added the official color tokens, five-tab mobile shell, PWA manifest and derivative icons, public-only offline cache, and update affordance.
5. Replaced the previous OpenAI path with disabled-by-default provider code and persistent counters. Gemini is limited to fixture testing for this portal because of the provider's audience terms.
6. Prepared a GitHub Actions workflow and an Express Vercel configuration. No deployment or production migration ran.

## Next development sequence

1. Introduce additive Prisma migrations from the existing `mun_` schema and migrate the individual API modules to strict TypeScript DTOs and versioned routes. Protect the data and retain compatibility for the existing portal during conversion.
2. Add password registration/recovery and a reviewable grant matrix. Complete role, committee and audit administration, activities and attendance, awards/reversals/badges, publish/archive states, and rest of the domain workflows in traceability.
3. Convert the existing UI route by route to the approved React/Vite stack. Complete Playwright interactions, physical-device PWA and full responsive screenshots.
4. Build verified identity and a durable dispatch outbox for OneSignal. Run authorized isolated staging tests with separate provider credentials.
5. Validate remaining release gates, measure staging and Lighthouse targets, then seek board approval for rollout.

See [requirements](REQUIREMENTS_TRACEABILITY.md) and [release status](FINAL_VERIFICATION_REPORT.md).

## Google and assistant integration checkpoint

- Added the same-origin `/api/auth/google/callback` contract with legacy route compatibility. OAuth registration no longer grants roles from environment email matching. The first President requires explicit operator provisioning.
- Added authenticated PostgreSQL full-text lookup for the assistant. The portal renders actual library titles, excerpts and source links and keeps the current conversation in the page session.
- Configured the nonsecret Google settings locally. Neon answered a read-only probe. No production migration, secret upload or provider activation was performed. The requested production URL returned a Vercel function failure.
