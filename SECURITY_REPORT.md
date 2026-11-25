# Security review

| Finding | Change / evidence |
|---|---|
| Google sign-in previously activated anyone | First sign-in records inactive membership, except the configured board owner. The integration test verifies board approval before a member receives a session. Existing member status is preserved. |
| Committee and position were self-editable | The profile API now allows display name and photo only. An attempted role field is rejected by the integration test. |
| Head posting was global | Direct mutations now check committee scope, and changing a grant affects existing sessions on the next request. The integration test covers pin denial, forced audience, and subsequent cross-committee visibility and vote denial. |
| Poll aggregates and scoped notification titles could be read outside intended conditions | Server-side poll results are hidden until a vote or management permission. Inbox reads use current committee scope. |
| Deployment startup changed database schema | Schema application is a separate command. Default runtime startup performs no schema changes or seed writes. |
| Prior provider could incur costs | The OpenAI path was removed. The new provider path is disabled by default. |

Existing protections checked by the suite include OAuth state replay prevention, origin enforcement, board endpoint denial, quiz key omission, unique vote/quiz submissions and session revocation. The suite uses test-generated binary signatures and synthetic accounts. It exercises local defensive checks only.

Open review items include persisted authentication rate limits, CSRF tokens, complete audit coverage, fine-grained grants, privacy/retention approval, HTML/script sanitization review, dependency scans in CI and a reviewed administrative recovery flow. No claim is made that high-severity application findings have been exhaustively ruled out.

The OAuth update removes email-based administrative elevation. It checks Google subject and verified email, serializes sign-in per normalized email and directs conflicts to board-assisted review. There is no automatic transfer of an existing account to a different Google subject. Configure the Google client secret only through local or host secret settings. Keys previously shared in chat or screenshots should be revoked and replaced through the provider console.
