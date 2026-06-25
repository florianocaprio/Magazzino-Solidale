---
name: API integration test harness
description: How automated tests are set up for the Express api-server (vitest + supertest, real DB).
---

# API integration test harness

The api-server is tested with **vitest + supertest**, running against the real
`DATABASE_URL` (no separate test DB is provisioned in this environment).

**Pattern:**
- Build a minimal Express app per test that mounts only the router under test, with
  a stub middleware that injects `req.user = { id }`. This bypasses sessions/RBAC
  (covered elsewhere) so tests focus on business logic.
- Seed rows directly via `db` inserts, tracking every created id in a "scope"
  object; delete them FK-safely in `afterEach`/`afterAll`.
- Use unique code prefixes (`TST-`, `TSTP-`, `test_op_`) so seeded rows are easy
  to identify and never collide with real data.
- `vitest.config.ts` sets `fileParallelism: false` because all tests share one DB.
- `pool.end()` in `afterAll` so the process exits cleanly.

**Why:** there is no isolated test database, so test isolation depends entirely on
self-cleanup + unique markers. Always verify zero orphaned rows after a run.

**How to apply:** reuse `artifacts/api-server/tests/helpers.ts` (app builder +
seed/cleanup helpers) for any new route test. Tests live in `tests/` which is
outside tsconfig `include: ["src"]`, so `pnpm typecheck` does NOT type-check them;
vitest transpiles via esbuild. Run with `pnpm --filter @workspace/api-server run test`.
