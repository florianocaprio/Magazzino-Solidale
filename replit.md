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
- **Report**: Stock by warehouse, deliveries by month, beneficiaries by zone — with Recharts charts; every list/entity exportable to XLSX and PDF (client-side: `xlsx` + `jspdf`/`jspdf-autotable`)
- **Report FSE+**: end-of-year EU social-fund rendicontazione (`GET /report/fse-plus?anno`). Lists all FSE+ products delivered (qty + total kg) and persons reached. Persons counts ALL household members (titolare + every nucleo member), split by sesso (M/F) × area provenienza (UE/Extra-UE) and adulti/minori. Delivered = bolla `stato IN (confermata,consegnata)` + `lotti.fse_plus=true`, filtered by bolla year. `beneficiariTotali`=distinct families; `personeTotali`=all persons. Null birthdate counts in M/F & UE totals but in neither adulti nor minori. Requires registry fields below.
- **Anagrafica beneficiari**: each person has `sesso` (M/F); `beneficiari.areaProvenienza` (UE/Extra-UE) is FAMILY-LEVEL (nucleo members inherit it). `nucleo_familiare.sesso` per member; età derived from `dataNascita`. Nucleo members are add/delete-editable in the beneficiary detail page (`DELETE /beneficiari/{id}/nucleo/{membroId}` scoped by both ids); the full anagrafica edit (incl. sesso/area) is in EditBeneficiarioSheet.
- **Bolle filtri**: the Bolle list is filterable by Magazzino and Centro di Ascolto (combinable — intersection). Centro filter joins `beneficiari.centroAscoltoId` (bolle have no direct centro). When a centro filter is active, internal docs (trasferimenti/scarichi) are hidden since they have no beneficiary/centro; the magazzino filter still applies to them client-side.
- **Bolle PDF**: delivery bills downloadable as PDF in 3 selectable templates (standard/moderno/minimal); header shows the beneficiary's Centro di Ascolto name/logo/address, footer shows custom text + association logo. Template + footer set in **Impostazioni Stampa** (singleton settings)
- **Provenienza lotti**: every lot has a provenance that is EITHER FSE+ (Fondo Sociale Europeo Plus, `lotti.fse_plus=true`, `fornitoreId` null) OR a Fornitore (`fornitoreId` set, `fse_plus=false`) — mutually exclusive, enforced server-side in `POST /lotti` (400 otherwise). Both `prodotti` and `lotti` carry an `fsePlus` flag; the product's flag/default supplier pre-selects provenance in the lot-creation forms. Lots are created in TWO places (Lotti "Nuovo Lotto" dialog AND prodotti "Carica in magazzino" CaricoForm) — both have the provenance selector; keep them in sync. The Lotti list has a Provenienza column; the prodotti edit sheet shows the product's lots with each lot's provenance (`ProdottoLotti` via `useListLotti({prodottoId})`). Lotti GET joins `fornitori` to return `fornitoreNome`.
- **Lotti**: the Lotti page (read-only tracking list) also has a "Nuovo Lotto" dialog to load a new lot of a product assigned to exactly ONE magazzino. A lot is never splittable across warehouses (enforced by the single `lotti.magazzinoId`); the dialog notes that moving part of the quantity requires a Trasferimento Interno. Create flow mirrors the prodotti "Carica in magazzino" pattern (createLotto + carico movimento; `causale` = donazione/acquisto/rettifica_inventario).
- **Trasferimenti**: create inter-warehouse transfers (origin+destination select, product rows from origin stock capped at available). Each transfer IS its own "bolla di trasferimento" (no separate bolla row — `bolle.beneficiarioId` is NOT NULL); on create a "Bolla creata" dialog offers a client-side PDF download. Transfers also appear in the Bolle list as read-only rows tagged "Trasferimento Interno" with a PDF download.
- **Scarico magazzino**: unload goods from a warehouse with a document-level `causale` (deteriorata/rubata/scaduta/altro free-text). Auto-decrements stock FEFO over `lotti` and logs `scarico` movimenti for audit. Each scarico IS its own "bolla di scarico" (`SCAR-YYYY-NNNN`) with a client-side PDF download (red accent); appears in the Bolle list as read-only rows tagged "Scarico Magazzino". Create handler is wrapped in `db.transaction` (the one place that uses transactions); `unitaMisura` is derived server-side from the product.
- **Dashboard**: Live KPIs, alerts for expiring lots and low stock, recent movements feed

## Gotchas

- After adding new schema files to `lib/db`, run `pnpm run typecheck:libs` BEFORE checking the API server — otherwise stale `.d.ts` declarations miss the new table exports.
- `db.execute(sql\`...\`)` returns a `QueryResult` with a `.rows` property — access `result.rows`, not the result directly.
- Decimal columns in Drizzle come back as strings; always `parseFloat()` before sending to the client.
- When passing `enabled` to an Orval-generated hook's `query` options, also pass `queryKey` or TypeScript will error.
- Bolla PDF template names (`standard|moderno|minimal`) live in 4 places (DB column, OpenAPI enum, API `VALID_TEMPLATES`, frontend PDF `ACCENT` map) — change them in lockstep + re-run codegen.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
