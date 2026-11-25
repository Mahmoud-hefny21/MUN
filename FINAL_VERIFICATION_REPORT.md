# Release verification

**Development status.** This working tree contains an incremental upgrade to the existing portal. The production acceptance gate is open.

The [traceability matrix](REQUIREMENTS_TRACEABILITY.md) lists 33 grouped requirement rows, including one deferred-scope row. Rows aggregate multiple sub-requirements and use conservative status labels. The matrix still needs sub-requirement-level expansion before release sign-off.

## Delivery

- Core additions include Google membership approval, committee-scoped posts, safer profile updates, scheduled quizzes, activities and attendance, an in-app inbox, PWA assets, the five-tab mobile shell and an Express runtime export.
- Added implementation assets include `assistant-providers.mjs`, `migrate.mjs`, the manifest/icons, offline worker and entry, browser verification helper, CI workflow, Vercel configuration and delivery reports.
- Updated existing server, database adapter, schema, browser client, integration tests, package files, environment example and README. Original logo bytes were preserved. No tracked feature files were deleted.

## Release gates still open

- Strict TypeScript/React/Vite/Prisma implementation, full versioned API, password registration/recovery, complete role grants, activities/attendance, badges/awards/reversals, publish/archive workflow and complete admin/audit features.
- OneSignal subscription and dispatch implementation, consent and preferences, physical-device push evidence, live provider AI approval, durable chat/caching and verified free-tier settings.
- Representative 140-user staging load/stress, complete browser matrix, actual iOS/Android install checks, Lighthouse scores, full accessibility regression and production backup/restore.
- Preview and production deployment, real OAuth test credentials, and board approvals.

See [test results](TEST_RESULTS.md), [security review](SECURITY_REPORT.md), [performance](PERFORMANCE_REPORT.md), [load baseline](LOAD_TEST_REPORT.md) and [deployment guide](DEPLOYMENT_GUIDE.md).

## OAuth and knowledge-search verification checkpoint

| Check | Status | Evidence |
|---|---|---|
| Google OAuth | BLOCKED live | Callback, signed Google fixture, one-time state, session and explicit admin provisioning passed locally. The live Google client secret was not supplied. |
| Gemini / Groq APIs | BLOCKED | Provider age and audience terms prevent activation for this rollout. No external request was sent. |
| Automatic provider fallback | BLOCKED live | Local club-library lookup was verified independently of providers. Live provider fallback remains unverified. |
| Local environment | FAIL complete | Nonsecret Google settings and Neon configuration are present. Live OAuth needs a local client secret. |
| Vercel environment | FAIL | Installed CLI reported logged out. The production root returned HTTP 500 with `FUNCTION_INVOCATION_FAILED`. No environment change or deploy occurred. |
| Database connectivity | PASS | Read-only `SELECT 1` passed on the configured Neon database. The new index was tested in isolated fixtures. |
| Core regression | PASS in covered scenarios | Integration suite and Chromium checks passed. Prisma and OneSignal remain pending from the earlier V5 audit. |
| Security | PASS for checks run | Known credential format scan found no tracked Git history matches. Dependency audit returned zero. OAuth and role checks passed locally. |
| Performance | FAIL target on local diagnostic | 140 simultaneous read requests from two fixture accounts, zero errors, p50 620 ms, p95 855 ms and p99 866 ms. Sustained staging, Lighthouse and 200-user stress were unverified. |

## OneSignal checkpoint

OneSignal v16 scoped worker, authenticated pseudonymous identity, explicit device opt-in, account preference, durable targeted outbox and delivery summary are implemented. Isolated fixtures validate allowlist enforcement, ES256 signature, deduplication, retry, delivery acceptance tracking and lock-screen payload privacy. No real notifications were sent. Local App ID and Safari ID are configured and the REST key is present. The identity key and eligible designated test accounts are missing, and Vercel CLI reported logged out. Production returned HTTP 500 on the read-only probe. See [push runbook](PUSH_RUNBOOK.md).
