---
name: Drizzle db.execute() returns QueryResult not array
description: db.execute(sql`...`) returns a QueryResult with a .rows property, not a plain array.
---

**Rule:** `db.execute(sql\`...\`)` with the node-postgres driver returns a `QueryResult<Record<string, unknown>>` — a pg `QueryResult` object, not an array.

**How to apply:**
```typescript
// WRONG – TS2352 cast error
const rows = await db.execute(sql`SELECT ...`) as Array<Record<string, unknown>>;

// CORRECT
const result = await db.execute(sql`SELECT ...`);
const rows = result.rows as Array<Record<string, unknown>>;
```

**Why:** The `QueryResult` type from `pg` wraps the rows in a `.rows` property. Direct cast to array fails the TypeScript overlap check.
