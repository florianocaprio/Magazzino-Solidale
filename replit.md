# Magazzino Solidale AIM

Gestionale per un magazzino solidale: tracciamento prodotti/lotti (FEFO), CRM beneficiari, consegne, trasferimenti, volontari, report — più modulo **Unità di Strada (UDS)** e scoping per **Città / Zona**.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server (port 5000)
- `pnpm --filter @workspace/magazzino-solidale run dev` — frontend (port varies)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run test` — API integration tests (vitest). Also the `test` validation step (quality gate alongside typecheck). Requires `DATABASE_URL` (runs against the real DB, cleans up after itself).
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` (Postgres), `SESSION_SECRET` (express-session signing)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9; build via esbuild (CJS bundle)
- Frontend: React + Vite + wouter + TanStack Query + shadcn/ui + Recharts
- API: Express 5; DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`) + `drizzle-zod`; API codegen: Orval (from `lib/api-spec/openapi.yaml`)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle tables (one file per domain entity); `index.ts` re-exports all — update when adding tables
- `lib/api-client-react/src/generated/api.ts` — generated React Query hooks
- `lib/api-zod/src/generated/api.ts` — generated Zod schemas for route validation
- `artifacts/api-server/src/routes/` — Express route handlers (one file per module)
- `artifacts/magazzino-solidale/src/pages/` — React page components

## Architecture decisions

- **Contract-first**: OpenAPI spec → Orval codegen → typed hooks + Zod schemas used in both FE and BE.
- **Stock (giacenze)** computed on-the-fly from `lotti.quantita_residua` aggregated per product+warehouse — no separate stock table. Adding stock REQUIRES creating a lotto; a movimento alone is only an audit log.
- **A lot lives in exactly ONE magazzino** (`lotti.magazzinoId`, never splittable); moving part of a quantity requires a Trasferimento Interno.
- **Provenienza lotti** is mutually exclusive: FSE+ (`lotti.fse_plus=true`, `fornitoreId` null) OR a Fornitore (`fornitoreId` set, `fse_plus=false`) — enforced in `POST /lotti` (400 otherwise).
- **Transfers** are 2-phase inside `db.transaction`: "avvia" FEFO-deducts righe from origin lots (availability-validated) + logs `trasferimento/uscita`; "conferma" rebuilds goods as new lots at destination (preserving scadenza/codiceLotto/fornitore/fsePlus via uscita movimenti) + logs `trasferimento/entrata`.
- **Auto-codes**: bolle `BOLLA-YYYY-NNNN`, scarichi `SCAR-YYYY-NNNN`; beneficiary codice from timestamp if not supplied.
- Each scarico/trasferimento IS its own bolla (no separate bolle row); they appear read-only in the Bolle list tagged accordingly, with client-side PDF.

## Product

### Magazzino
- Warehouses, products (multi-category), lots with expiry (FEFO), movements (load/unload), real-time stock, inter-warehouse transfers.
- **Lotti** page: read-only tracking list + "Nuovo Lotto" dialog (createLotto + carico movimento; `causale` = donazione/acquisto/rettifica_inventario). Provenienza column. Lots are created in TWO forms — Lotti dialog AND prodotti "Carica in magazzino" CaricoForm — **keep both in sync**; product flag/default supplier pre-selects provenance.
- **Scarico magazzino**: unload with document-level `causale` (deteriorata/rubata/scaduta/altro). FEFO-decrements lots + logs `scarico` movimenti, wrapped in `db.transaction` (the one place using transactions). `unitaMisura` derived server-side. Optional `centroAscoltoId`. Scarichi list has Centro filter + sortable Date header.
- **Trasferimenti**: origin+destination + product rows capped at origin stock. On create, a "Bolla creata" dialog offers PDF.
- **Dashboard**: live KPIs, expiring-lot + low-stock alerts, recent movements feed.

### Sociale
- Beneficiary CRM with family dossier (nucleo familiare), social intervention log, delivery planning calendar, delivery documents (bolle).
- **Anagrafica beneficiari**: per-person `sesso` (M/F); `beneficiari.areaProvenienza` (UE/Extra-UE) is FAMILY-LEVEL (nucleo inherits it); `nucleo_familiare.sesso` per member; età from `dataNascita`. Full edit (sesso/area, priorità, consegna a domicilio, note assistenziali) lives in `EditBeneficiarioSheet` (exported from `beneficiario-dettaglio.tsx`), reused from the LIST via `QuickEditBeneficiario` (fetches full record with `useGetBeneficiario(id)` before mounting to avoid clobbering list-projection-absent fields; invalidates list+detail).
- **Stato attivo**: `attivo` flag; LIST has a Stato column with activate/deactivate Switch and dims inactive rows; also filterable by priorità. `GET /beneficiari` accepts `attivo`. Pickers (consegne, bolle create+edit) query `{attivo:true, centroAscoltoId}` — only ACTIVE beneficiaries of the selected centro (UI-level filtering).
- **Auto-downgrade priorità**: scheduled job (`lib/priorityDowngrade.ts`, wired after seedAdmin) forces `priorita='bassa'` for beneficiaries whose `COALESCE(dataPresaInCarico, dataCreazione)` is >2yr old; startup + daily, idempotent. Re-applies daily, so it intentionally overrides manual priority bumps for >2yr beneficiaries.
- **Bolle** (delivery bills): filterable by Magazzino + Centro (combinable). Stati bozza/confermato/consegnato/annullato. **Trasportatore**: EITHER `volontarioConsegnaId` OR free-text `trasportatoreNome` (self-pickup default "Ritiro presso il magazzino") — mutually exclusive. PDF in 3 templates (standard/moderno/minimal); header = beneficiary's Centro name/logo/address, footer = custom text + association logo (set in **Impostazioni Stampa**, singleton). FSE+ righe marked "*". `BollaDettaglio` (shared component, exported from `pages/bolle.tsx`) joins magazzini + beneficiari for full addresses.
- **Consegne**: stati pianificata/effettuata; readiness derives from the linked bolla.stato. "Associa bolla" picker lists only assignable bolle for that beneficiario (not annullato, not consegnato, not linked elsewhere). Bolla badge/action opens the read-only `BollaDettaglio` Sheet.

### Logistica
- Volunteer management, vehicle fleet, supplier/donor registry, procurement planning.
- **Volontari centro**: nullable `centroAscoltoId` (NULL = universal). Delivery pickers show a volontario if `centroAscoltoId IS NULL` OR equals the **selected beneficiary's** centro (derived from the chosen beneficiary, NOT the UI filter, so "Tutti" never leaks centre-specific volunteers). Client-side only.
- **Approvvigionamenti (ordini)**: 3-state workflow `bozza → sottomesso → completato`. New orders = `bozza` (editable via PATCH). "Sottometti" sets `sottomesso` + best-effort emails amministrazione@angeliinmoto.it (`lib/orderEmail.ts`, try/catch so submit never fails). Email is currently a logged no-op (no sender configured; Gmail integration dismissed) — wire real delivery in `sendApprovvigionamentoEmail`. Carry `magazzinoId`+`centroAscoltoId`; filterable by both + stato. Note Textarea included in the email.

### Report (Analisi)
- Stock by warehouse, deliveries by month, deliveries by centro, FSE+ — Recharts; every list/entity exportable to XLSX + PDF (client-side `xlsx` + `jspdf`/`jspdf-autotable`).
- Global filter bar: **Periodo** (da/a), **Magazzino**, **Centro**. Endpoints accept `da`/`a` (ISO; fall back to `anno` then current year), `magazzinoId`, `centroAscoltoId` (all optional). Consegne reports join `beneficiari` for the centro filter (consegne have no direct centro column). FSE+ keeps its own statutory year selector.
- **Consegne per Centro** (`GET /report/consegne-per-centro`, placed before FSE+): groups `stato='effettuata'` consegne by centro (via beneficiario), split dirette dal centro (`volontario_id IS NULL`) vs con volontari + totale; no-centro → "Senza centro di ascolto".
- **FSE+** (`GET /report/fse-plus?anno`): end-of-year EU social-fund rendicontazione. Counts ALL household members (titolare + every nucleo member), split by sesso (M/F) × area (UE/Extra-UE) and adulti/minori. Delivered = bolla `stato IN (confermata,consegnata)` + `lotti.fse_plus`, by bolla year. Null birthdate counts in M/F & UE totals but in neither adulti nor minori.

### Operatore (audit)
- Every bolla, trasferimento, scarico AND intervento records the last operator via nullable `operatoreId` FK → `utenti`, stamped server-side with `req.user!.id` on create AND every mutating action. All list+dettaglio endpoints return `operatoreId` + non-personal `operatoreCodice` = `matricola ?? username`. Printed on all 3 PDFs + Interventi list/export. Bolla-synced interventi inherit the bolla's operatore.

## Sicurezza, Accessi & Scoping

- **Auth**: session-based (username/password, bcryptjs). Areas: `generale/magazzino/sociale/logistica/analisi/amministrazione` (+ `uds` planned). Roles (`ruoli`) define allowed `aree` (jsonb string[]) + `isAdmin`. Users (`utenti`) have `nome`+`cognome` (cognome nullable col but required on create), a role, optional `matricola`.
  - **Matricola autogen**: blank on `POST /utenti` → `initial(nome)+initial(cognome)+ddyy` uppercased (e.g. Mario Rossi on 24 Jun 2026 → `MR2426`); server-side only, no collision handling; trimmed first.
  - Seed admin (`admin`/`flocap!`, `mustChangePassword=true`) idempotent at startup (`lib/seedAdmin.ts`). Forced password change enforced server-side too: `requirePasswordChange` returns 403 on every protected route while `mustChangePassword`, allowing only `/auth/me`, `/auth/change-password`, `/auth/logout`.
  - Nav hides non-allowed areas (`hasArea`) but the boundary is backend `areaGuard` (route-segment → area map). Admin-only Utenti + Ruoli CRUD (`requireAdmin`). Last-admin lockout blocked on BOTH user mutations AND role demotion; self-delete blocked.
  - **Idle auto-logout (15 min)**: server session `rolling:true` + `cookie.maxAge=15min`; client idle timer (`lib/use-idle-logout.ts`) logs out after 15 min of no interaction and fires a keepalive (refetch `/auth/me`) at most once / 5 min while active.
- **Scoping per Centro di Ascolto** (additive to aree RBAC, server-side; FE locking is UX only): user `centroAscoltoId != null` → sees own centro OR shared (`centro IS NULL`); null = global. Helpers in `lib/centroScope.ts`. Scope sources: **direct col** (beneficiari, scarichi, approvvigionamenti, fornitori, volontari, magazzini); **via beneficiario** (consegne, bolle, interventi); **via visible magazzini set** (lotti, giacenze, movimenti, trasferimenti). Create paths auto-assign+lock the caller's centro; PATCH re-validates body-supplied FKs (IDOR guard) → 403 if outside. `utenti` scoping is intentionally STRICT (own centro only, NO shared/null). report/dashboard scoped via SQL fragments. `prodotti` stays GLOBAL.
- **Scoping per Città / Zona UDS** (new top-level axis, additive to centro + aree):
  - **Città** = HARD visibility boundary (an operator never sees another città's people). **Zona UDS** (municipio) under a città = SOFT preference (operator sees their zone first, can filter the whole città).
  - Columns: `utenti.cittaId` (nullable = global super-admin) + `utenti.zonaUdsId` (nullable = all zones of the città); `centri_ascolto.cittaId`, `magazzini.cittaId`, `beneficiari.cittaId` + `beneficiari.zonaUdsId` + `beneficiari.soprannome`. Tables `citta` + `zone_uds` (`cittaId` FK).
  - `/auth/me` exposes `cittaId/cittaNome/zonaUdsId/zonaUdsNome`. Admin CRUD pages **Città** + **Zone UDS** (area amministrazione). Utenti form has a Città select + a dependent Zona UDS select ("Tutte le zone" = null; zona disabled until a città is chosen).
  - Scoping helpers live alongside centro scoping (città hard filter on the direct col / via beneficiario / via visible magazzini); IDOR guards on PATCH mirror the centro pattern. `prodotti` stay global.
- **Canale persona (UDS / Centro / entrambi)**: ONE person record. `centroAscoltoId` set = centro member; `zonaUdsId` set = UDS. A person can be both; visible to both staffs.

## i18n (FULL GUI)

- Entire app translatable across 6 languages — it/es/en/fr/de/ar (Arabic RTL). Language Select in the sidebar footer; choice persists to `localStorage` (`ms-lang`, default `it`).
- Powered by `i18next` + `react-i18next`. Setup in the `src/lib/i18n/` DIRECTORY: `index.ts` (init; merges all namespaces into one `translation` namespace; re-exports `LANGUAGES`/`isRtl`/`applyDirection`), `languages.ts`, `namespaces/base.ts` (shared `common.*` + `nav.*`), one `namespaces/<page>.ts` per page exporting `export const <ns> = { it, es, en, fr, de, ar } as const` with identical key sets.
- `main.tsx` imports `./lib/i18n` BEFORE `App`. Arabic sets `<html dir="rtl">` via `applyDirection()`. NAV_ITEMS carry stable `key`/`groupKey` → translation keys.
- **To extend**: add a namespace file, register it in `index.ts`, use `useTranslation()`. Validation messages: build zod schemas via factory fns inside the component (`makeXSchema(t)` + `useMemo`) — NEVER call `i18n.t()` at module scope for schema messages. Text baked into PDFs (jspdf) and persisted data defaults are intentionally NOT translated.

## Gotchas

- **Session storage**: `connect-pg-simple`'s bundled `table.sql` is NOT picked up by the esbuild CJS bundle, so the session table is a normal Drizzle table (`userSessionsTable`, `user_sessions`, cols sid/sess/expire) in `lib/db/src/schema/auth.ts` with `createTableIfMissing:false`.
- **Auth cookies** `SameSite=None;Secure` + `trust proxy 1` for the cross-site preview iframe. Because of `SameSite=None`, a CSRF Origin/Referer allowlist guard (from `REPLIT_DOMAINS`/`REPLIT_DEV_DOMAIN`) runs for all non-GET/HEAD `/api` requests — curl POSTs must send a matching `-H "Origin: https://$REPLIT_DEV_DOMAIN"` or get 403.
- After adding schema files to `lib/db`, run `pnpm run typecheck:libs` BEFORE checking the API server or new table exports are missing.
- `db.execute(sql\`...\`)` returns a `QueryResult` — access `result.rows`.
- Decimal columns come back as strings — `parseFloat()` before sending to the client.
- When passing `enabled` to an Orval hook's `query` options, also pass `queryKey` or TS errors.
- Bolla PDF template names (`standard|moderno|minimal`) live in 4 places (DB column, OpenAPI enum, API `VALID_TEMPLATES`, frontend PDF `ACCENT` map) — change in lockstep + re-run codegen.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
