# Local load baseline

`MUN_LOAD_BASELINE=1 npm test` issued 140 simultaneous HTTP reads of the authenticated session snapshot, split across two synthetic accounts. Node.js 26.13.1 and PGlite ran on the local Windows workspace. Duration includes creating the HTTP request and reading the complete response. Latest measured result at this checkpoint:

| Requests | Accounts | Errors | p50 | p95 | p99 |
|---:|---:|---:|---:|---:|---:|
| 140 | 2 | 0 | 624 ms | 867 ms | 868 ms |

This is a burst diagnostic. The release gate requires distinct synthetic accounts, realistic read/write mix, warm and cold profiles, sustained 140-user traffic, isolated 200-user stress, integrity checks, recovery and environment metrics. Those scenarios were not run. No external providers or member records were contacted by this test.
