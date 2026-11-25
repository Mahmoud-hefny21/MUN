# Test results

Local Windows and Node.js 26.13.1 with isolated PGlite, synthetic Google accounts and signed fixture responses.

| Check | Observed result |
|---|---|
| `npm run typecheck` | Passed for the shared strict TypeScript contracts |
| `npm run build` | Passed syntax checks for the current runtime and public scripts |
| `npm test` | Passed HTTP/DB integration suite including approval, scoped permissions, inbox visibility, attendance, daily schedule, duplicate vote and concurrent quiz protection |
| `MUN_BROWSER=1 npm test` | Passed Chromium browser checks over nine routes and 12 widths. Verified absence of horizontal overflow, mobile tab visibility/order, logout, worker cache and offline recovery |
| `npm audit --audit-level=high` | Registry reported zero dependency vulnerabilities |

The real browser connected to the local application and its isolated database. Sign-in used a signed Google fixture. Two screenshots from the baseline are retained in [docs/qa/screenshots](docs/qa/screenshots). Home at 390 px was manually inspected. Full visual review, Firefox, WebKit, physical device installation, live OAuth, live AI and push remain unverified. The syntax check is the build gate for the existing buildless frontend. The Vite production build remains pending.

The OAuth/assistant follow-up passed type checking, syntax checks, the integration suite and Chromium browser verification. The browser searched the authenticated library and cleared the conversation with New chat. The suite checked that a new Google registration remains pending until explicit approval. A separate read-only Neon connectivity probe succeeded.

The mobile dock follow-up passed Chromium layout checks at 12 widths. Each visible tab met the 44px minimum touch target. The 320px chat send button remained above the dock, and keyboard focus without a resized viewport left navigation available.
