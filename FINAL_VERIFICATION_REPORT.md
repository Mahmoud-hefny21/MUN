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
