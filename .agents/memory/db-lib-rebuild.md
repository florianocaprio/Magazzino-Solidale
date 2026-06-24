---
name: Rebuild db lib declarations before checking API server
description: After adding new schema files to lib/db, typecheck:libs must be run before the API server will see the new exports.
---

**Rule:** After adding or modifying schema files in `lib/db/src/schema/`, always run `pnpm run typecheck:libs` before typechecking `artifacts/api-server`. Otherwise the stale `.d.ts` declarations won't include the new table exports and you'll get `Module '"@workspace/db"' has no exported member 'xyzTable'` errors.

**How to apply:**
```bash
# After changing lib/db schema:
pnpm run typecheck:libs
# Then check the API server:
pnpm --filter @workspace/api-server run typecheck
```

**Why:** `lib/db` is a composite lib that emits declarations via `tsc --build`. The API server imports from the emitted `.d.ts`, not the source. If the lib isn't rebuilt, the old declarations are used.
