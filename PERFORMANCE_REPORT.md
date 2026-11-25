# Performance evidence

A loopback read-burst baseline is recorded in [LOAD_TEST_REPORT.md](LOAD_TEST_REPORT.md). The measured p95 exceeds the 500 ms target under those conditions. It does not establish application latency on Neon or Vercel.

The current session snapshot bundles multiple modules and reads too much data for a single route. As the REST modules are split, use bounded per-route queries and cursor pagination and use staging query plans to identify high-cost joins or scans. Keep app shell caching public-only.

Lighthouse scores, field LCP/INP/CLS, mobile transfer budget and production p95 have not been measured.
