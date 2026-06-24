# Magazzino Solidale AIM

Gestionale per un magazzino solidale: tracciamento di prodotti/lotti (FEFO), CRM beneficiari, consegne, trasferimenti, volontari e report.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/magazzino-solidale run dev` — run the frontend (port varies)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + wouter + TanStack Query + shadcn/ui + Recharts
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle table definitions (one file per domain entity)
- `lib/db/src/schema/index.ts` — re-exports all schemas; update when adding new tables
- `lib/api-client-react/src/generated/api.ts` — generated React Query hooks
- `lib/api-zod/src/generated/api.ts` — generated Zod schemas for route validation
- `artifacts/api-server/src/routes/` — Express route handlers (one file per module)
- `artifacts/magazzino-solidale/src/pages/` — React page components

## Architecture decisions

- Contract-first API: OpenAPI spec → Orval codegen → typed hooks + Zod schemas used in both FE and BE.
- Stock (giacenze) is computed on-the-fly from `lotti.quantita_residua` aggregated per product+warehouse — no separate stock table.
- Transfers are a 2-phase workflow: "avvia" deducts from origin lot, "conferma" confirms receipt at destination.
- Delivery bills (`bolle`) get auto-incremented numeric codes in format `BOLLA-YYYY-NNNN`.
- Beneficiary codice auto-generated from timestamp if not provided by caller.

## Product

- **Magazzino**: CRUD for warehouses, products (multi-category), lots with expiry (FEFO), movements (load/unload), real-time stock levels, inter-warehouse transfers
- **Sociale**: Beneficiary CRM with family dossier, social intervention log, delivery planning calendar, delivery documents (bolle)
- **Logistica**: Volunteer management, vehicle fleet, supplier/donor registry, procurement planning
- **Report**: Stock by warehouse, deliveries by month, beneficiaries by zone — with Recharts charts
- **Dashboard**: Live KPIs, alerts for expiring lots and low stock, recent movements feed

## Gotchas

- After adding new schema files to `lib/db`, run `pnpm run typecheck:libs` BEFORE checking the API server — otherwise stale `.d.ts` declarations miss the new table exports.
- `db.execute(sql\`...\`)` returns a `QueryResult` with a `.rows` property — access `result.rows`, not the result directly.
- Decimal columns in Drizzle come back as strings; always `parseFloat()` before sending to the client.
- When passing `enabled` to an Orval-generated hook's `query` options, also pass `queryKey` or TypeScript will error.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
