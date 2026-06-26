# Magazzino Solidale AIM

Gestionale per un magazzino solidale: tracciamento prodotti/lotti (FEFO), CRM beneficiari, consegne, trasferimenti, volontari, report — più modulo **Unità di Strada (UDS)** e scoping per **Città / Zona**.

> Comunicare con l'utente in **italiano**.

## Indice
- [Run & Operate](#run--operate) · [Stack](#stack) · [Dove stanno le cose](#dove-stanno-le-cose)
- [Decisioni architetturali](#decisioni-architetturali)
- [Prodotto](#prodotto): Magazzino · Sociale · Logistica · Report · UDS · Operatore
- [Sicurezza, Accessi & Scoping](#sicurezza-accessi--scoping)
- [i18n](#i18n-full-gui) · [Gotchas](#gotchas) · [Pointers](#pointers)

---

## Run & Operate

Le app girano tramite **workflow** Replit (porte assegnate via `PORT`, non fisse). Comandi utili:

- `pnpm --filter @workspace/api-server run dev` — API server (Express)
- `pnpm --filter @workspace/magazzino-solidale run dev` — frontend (Vite)
- `pnpm run typecheck` — typecheck completo su tutti i package
- `pnpm run build` — typecheck + build
- `pnpm --filter @workspace/api-server run test` — test d'integrazione API (vitest). È anche il validation step `test` (quality gate insieme a `typecheck`). Richiede `DATABASE_URL` (gira sul DB reale, fa pulizia da solo).
- `pnpm --filter @workspace/api-spec run codegen` — rigenera hook API + schemi Zod dall'OpenAPI
- `pnpm --filter @workspace/db run push` — push delle modifiche di schema (solo dev)
- `pnpm --filter @workspace/scripts run bonifica:matricole` — rigenera tutte le matricole esistenti (one-off)

**Env richiesti**: `DATABASE_URL` (Postgres), `SESSION_SECRET` (firma express-session).

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9; build via esbuild (bundle CJS)
- **Frontend**: React + Vite + wouter + TanStack Query + shadcn/ui + Recharts
- **API**: Express 5 · **DB**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`) + `drizzle-zod` · **Codegen**: Orval (da `lib/api-spec/openapi.yaml`)

## Dove stanno le cose

- `lib/api-spec/openapi.yaml` — fonte di verità di tutti i contratti API
- `lib/db/src/schema/` — tabelle Drizzle (un file per entità); `index.ts` riesporta tutto — aggiornare quando si aggiunge una tabella
- `lib/api-client-react/src/generated/api.ts` — hook React Query generati
- `lib/api-zod/src/generated/api.ts` — schemi Zod generati per la validazione delle route
- `artifacts/api-server/src/routes/` — handler Express (un file per modulo)
- `artifacts/magazzino-solidale/src/pages/` — componenti pagina React

## Decisioni architetturali

- **Contract-first**: OpenAPI → codegen Orval → hook tipizzati + schemi Zod usati sia FE sia BE.
- **Giacenze** calcolate al volo da `lotti.quantita_residua` aggregato per prodotto+magazzino — nessuna tabella stock separata. Aggiungere stock RICHIEDE creare un lotto; un movimento da solo è solo audit log.
- **Un lotto vive in UN SOLO magazzino** (`lotti.magazzinoId`, mai divisibile); spostare parte di una quantità richiede un Trasferimento Interno.
- **Provenienza lotti** mutuamente esclusiva: FSE+ (`lotti.fse_plus=true`, `fornitoreId` null) OPPURE un Fornitore (`fornitoreId` valorizzato, `fse_plus=false`) — imposto in `POST /lotti` (altrimenti 400).
- **Trasferimenti** a 2 fasi dentro `db.transaction`: "avvia" scala FEFO le righe dai lotti origine (con validazione disponibilità) + logga `trasferimento/uscita`; "conferma" ricostruisce la merce come nuovi lotti a destinazione (preservando scadenza/codiceLotto/fornitore/fsePlus dai movimenti di uscita) + logga `trasferimento/entrata`.
- **Codici automatici**: bolle `BOLLA-YYYY-NNNN`, scarichi `SCAR-YYYY-NNNN`; codice beneficiario da timestamp se non fornito.
- Ogni scarico/trasferimento È la propria bolla (nessuna riga `bolle` separata); compaiono in sola lettura nella lista Bolle, taggati, con PDF lato client.

---

## Prodotto

### Magazzino
- Magazzini, prodotti (multi-categoria), lotti con scadenza (FEFO), movimenti (carico/scarico), giacenze realtime, trasferimenti tra magazzini.
- **Lotti**: lista di tracciamento read-only + dialog "Nuovo Lotto" (createLotto + movimento di carico; `causale` = donazione/acquisto/rettifica_inventario), con colonna Provenienza.
  - I lotti si creano in DUE form — dialog Lotti E "Carica in magazzino" (CaricoForm) dei prodotti — **tenerli allineati**; il flag prodotto / fornitore di default pre-seleziona la provenienza.
- **Scarico magazzino**: scarico con `causale` a livello documento (deteriorata/rubata/scaduta/altro). Scala FEFO i lotti + logga movimenti `scarico`, dentro `db.transaction` (l'unico punto con transazione esplicita). `unitaMisura` derivata server-side. `centroAscoltoId` opzionale. Lista con filtro Centro + header Data ordinabile.
- **Trasferimenti**: origine+destinazione + righe prodotto limitate allo stock origine. Alla creazione un dialog "Bolla creata" offre il PDF.
- **Dashboard**: KPI live, alert lotti in scadenza + sotto-scorta, feed movimenti recenti.

### Sociale
- CRM beneficiari con dossier familiare (nucleo familiare), log interventi sociali, calendario pianificazione consegne, documenti di consegna (bolle).
- **Anagrafica beneficiari**: `sesso` (M/F) per persona; `beneficiari.areaProvenienza` (UE/Extra-UE) è a livello FAMIGLIA (il nucleo lo eredita); `nucleo_familiare.sesso` per membro; età da `dataNascita`.
  - Modifica completa (sesso/area, priorità, consegna a domicilio, note assistenziali) in `EditBeneficiarioSheet` (export da `beneficiario-dettaglio.tsx`), riusata dalla LISTA via `QuickEditBeneficiario` (carica il record completo con `useGetBeneficiario(id)` prima del mount per non sovrascrivere campi assenti nella proiezione lista; invalida lista+dettaglio).
- **Stato attivo**: flag `attivo`; la LISTA ha colonna Stato con Switch attiva/disattiva e sfuma le righe inattive; filtrabile anche per priorità. `GET /beneficiari` accetta `attivo`. I picker (consegne, bolle create+edit) interrogano `{attivo:true, centroAscoltoId}` — solo beneficiari ATTIVI del centro scelto (filtro lato UI).
- **Auto-downgrade priorità**: job schedulato (`lib/priorityDowngrade.ts`, montato dopo seedAdmin) forza `priorita='bassa'` per i beneficiari con `COALESCE(dataPresaInCarico, dataCreazione)` > 2 anni; allo startup + giornaliero, idempotente. Riapplicandosi ogni giorno, sovrascrive intenzionalmente gli aumenti manuali di priorità per beneficiari > 2 anni.
- **Bolle** (documenti di consegna): filtrabili per Magazzino + Centro (combinabili). Stati bozza/confermato/consegnato/annullato.
  - **Trasportatore**: O `volontarioConsegnaId` O testo libero `trasportatoreNome` (ritiro autonomo, default "Ritiro presso il magazzino") — mutuamente esclusivi.
  - PDF in 3 template (standard/moderno/minimal); intestazione = nome/logo/indirizzo del Centro del beneficiario, footer = testo custom + logo associazione (in **Impostazioni Stampa**, singleton). Righe FSE+ marcate "*".
  - `BollaDettaglio` (componente condiviso, export da `pages/bolle.tsx`) fa join magazzini + beneficiari per gli indirizzi completi. Accetta `hideConsegnaActions` + `onClose`/`onCloseLabel` (es. aperto dalla pianificazione consegne nasconde le azioni di consegna e mostra solo il pulsante "indietro").
- **Consegne**: stati pianificata/effettuata; la "prontezza" deriva dalla `bolla.stato` collegata. Il picker "Associa bolla" elenca solo le bolle assegnabili per quel beneficiario (non annullato, non consegnato, non già collegate altrove). Il badge/azione bolla apre la Sheet read-only `BollaDettaglio`.

### Logistica
- Gestione volontari, parco mezzi, anagrafica fornitori/donatori, pianificazione approvvigionamenti.
- **Ruoli Volontari** (pagina admin sotto amministrazione, tabella `ruoli_volontari`): picklist configurabile dei ruoli che sostituisce le 4 vecchie opzioni hardcoded.
  - `volontari.ruolo` resta un NOME ruolo testo libero (NESSUNA FK) — la tabella pilota solo il select; seed con chiavi legacy (magazziniere/autista/operatore_sportello/coordinatore) così righe esistenti + label i18n `volontari.roles.<key>` continuano a funzionare.
  - Display via `t(\`volontari.roles.<nome>\`, {defaultValue: nome})`. Select mostra i ruoli attivi O il valore corrente della riga. GET leggibile da logistica; mutazioni requireAdmin; il delete ritira solo l'opzione. Ruoli GLOBALI (no scoping città/centro).
  - **NOTA**: la sua voce `AREA_BY_SEGMENT` è `"logistica"` da sola, NON `["logistica","amministrazione"]` — aggiungere "amministrazione" farebbe negare l'accesso ai non-admin via areaGuard.
- **Volontari per centro**: `centroAscoltoId` nullable (NULL = universale). I picker consegne mostrano un volontario se `centroAscoltoId IS NULL` O uguale al centro del **beneficiario selezionato** (derivato dal beneficiario scelto, NON dal filtro UI, così "Tutti" non fa trapelare volontari specifici). Solo lato client.
- **Tipologie Fornitore**: picklist configurabile dei tipi fornitore (analoga ai Tipi di Intervento); `fornitori.tipo` resta testo libero (no FK). Seed dei tipi predefiniti allo startup.
- **Approvvigionamenti (ordini)**: workflow a 3 stati `bozza → sottomesso → completato`. Nuovi ordini = `bozza` (editabili via PATCH).
  - "Sottometti" imposta `sottomesso` + invio mail best-effort a amministrazione@angeliinmoto.it (`lib/orderEmail.ts`, try/catch così il submit non fallisce mai).
  - Email reale via **connettore Gmail Replit** (`@replit/connectors-sdk`, connettore `google-mail`, account info@angeliinmoto.it): `sendApprovvigionamentoEmail` costruisce un messaggio RFC 2822 e lo POSTa a `gmail/v1/users/me/messages/send` tramite `connectors.proxy` (OAuth gestito dall'SDK). Lancia eccezione su errore, ma il chiamante la inghiotte.
  - Porta `magazzinoId`+`centroAscoltoId`; filtrabile per entrambi + stato. La nota (Textarea) è inclusa nell'email.

### Report (Analisi)
- Stock per magazzino, consegne per mese, consegne per centro, FSE+ — Recharts; ogni lista/entità esportabile in XLSX + PDF (lato client: `xlsx` + `jspdf`/`jspdf-autotable`).
- Barra filtri globale: **Periodo** (da/a), **Magazzino**, **Centro**. Gli endpoint accettano `da`/`a` (ISO; fallback su `anno` poi anno corrente), `magazzinoId`, `centroAscoltoId` (tutti opzionali). I report consegne fanno join `beneficiari` per il filtro centro (le consegne non hanno colonna centro diretta). FSE+ mantiene il proprio selettore d'anno statutario.
- **Consegne per Centro** (`GET /report/consegne-per-centro`, prima di FSE+): raggruppa le consegne `stato='effettuata'` per centro (via beneficiario), separando dirette dal centro (`volontario_id IS NULL`) vs con volontari + totale; senza centro → "Senza centro di ascolto".
- **FSE+** (`GET /report/fse-plus?anno`): rendicontazione fondo sociale UE di fine anno. Conta TUTTI i membri del nucleo (titolare + ogni membro), spaccati per sesso (M/F) × area (UE/Extra-UE) e adulti/minori. Consegnato = bolla `stato IN (confermata,consegnata)` + `lotti.fse_plus`, per anno bolla. Data di nascita nulla conta nei totali M/F & UE ma né in adulti né in minori.

### Unità di Strada (UDS)
- Modulo street-outreach leggero (area `uds`, ruolo "Operatore UDS" = aree `["uds"]`), SENZA magazzino. Riusa il record persona condiviso (beneficiari) + interventi — una persona UDS è un beneficiario con il flag booleano `uds` esplicito (indipendente da zona/centro). Un record può essere UDS e/o Centro. Il backend `AREA_BY_SEGMENT` mappa beneficiari/interventi a ENTRAMBE `["sociale","uds"]`.
- **Flag `uds` & invariante città**: `beneficiari.uds` (boolean, default false) guida l'appartenenza UDS, indipendente da `zonaUdsId`. Una persona `uds=true` deve SEMPRE avere città non-null (altrimenti trapela tra tutte le città).
  - Imposto server-side su `POST` E `PATCH /beneficiari` per ogni percorso che lo setta (form UDS, toggle "anche UDS" standard, toggle dettaglio): il flag è normalizzato via `toBool` (così `uds:"true"`/`1` non bypassa per type-confusion), poi i chiamanti scoped pinnano la propria città (incl. righe legacy null su PATCH) e i chiamanti globali devono fornire una città o ricevono 400. Il form beneficiari standard richiede la città lato client quando "anche UDS" è attivo per un admin globale.
- **UDS Anagrafica** (`pages/uds-anagrafica.tsx`): lista persone filtrate `uds=true`, scoping città (hard, server-side) + filtro **Zona** che default sulla zona dell'operatore (`user.zonaUdsId`), "Tutta la città" = tutte. Il super-admin globale (`user.cittaId==null`) ha anche un filtro **Città**.
  - Form di creazione con campi beneficiari COMPLETI incl. select **Centro di ascolto** (`useListCentriAscolto`, "Nessuno"=null) E toggle **anche UDS** (`uds`, default on) che GATE i campi città/zona (nascosti se off); città richiesta lato client (zod `superRefine`) solo se `isGlobal && uds`; `zonaUdsId` rimosso dal payload quando `uds` off.
  - Righe lista: il nome è un **Link** a `/beneficiari/:id`, righe inattive sfumate, + colonna Switch **Stato** (`attivo` via PATCH, invalida lista+dettaglio). **Badge canale** (da `uds` + `centroAscoltoId`): uds+centro→Entrambi, centro→Centro, uds→UDS, nessuno→Non classificato.
- **UDS Interventi** (`pages/uds-interventi.tsx`): picker persona scoping città + filtro **Zona** (default `user.zonaUdsId`, "Tutte le zone"=tutte) e, per admin globali, filtro **Città**; query `useListBeneficiari({uds:true, cittaId?, zonaUdsId?})`. Cambiare un filtro resetta la persona selezionata.
  - Crea intervento di strada = `dataIntervento`/`tipoIntervento` (ascolto/distribuzione/orientamento/salute/altro) + bisogni come nota libera in `descrizione` + materiale in `note`. Export XLSX/PDF per persona via `ExportButtons`.
  - Ogni riga ha azione **Pencil** (riusa la Sheet di creazione in modalità edit via `useUpdateIntervento`) e azione gialla **StickyNote** che apre un Dialog su un campo DEDICATO `interventi.noteUds` (testo "note_uds") — separato da `note`/Materiale; con `noteUds` valorizzato la riga si tinge d'ambra e la colonna Note mostra il box giallo. `noteUds` passa per `POST`/`PATCH /interventi` (spread di req.body) ed è restituito sia da lista sia da dettaglio (il mapper lista deve includerlo).
- **Route guard `/beneficiari/:id`** accetta `sociale` O `uds` (`Guard` di App.tsx prende `string | string[]`), così un operatore UDS apre il dettaglio condiviso dalla lista UDS — rispecchia la mappatura backend `AREA_BY_SEGMENT`.
- **Anti-doppione fuzzy** (`GET /beneficiari/cerca-simili`, prima di `/beneficiari/:id`): similarità Postgres `pg_trgm` su nome+cognome (e invertito via `GREATEST`), soprannome (*0.5), telefono (esatto 0.5 / sim *0.3), dataNascita (esatto +0.4); soglia 0.2, `ORDER BY score`, LIMIT 10; supporta `excludeId`.
  - **Città-HARD-scoped** via `callerCittaId` (scoped → propria città O NULL legacy; globale può restringere con `?cittaId`). Estensione abilitata idempotentemente allo startup (`lib/dbInit.ts`).
  - FE: pannelli suggerimento debounced (300ms) in `uds-anagrafica.tsx` (azioni Aggiungi a UDS via PATCH `zonaUdsId` / Già presente / Continua come nuova persona) e nel form di creazione `beneficiari.tsx` (pannello ambra dopo i campi nome → Apri dettaglio esistente / Continua come nuovo). Suggerisce, non fonde mai.

### Operatore (audit)
- Ogni bolla, trasferimento, scarico E intervento registra l'ultimo operatore via FK nullable `operatoreId` → `utenti`, marcato server-side con `req.user!.id` alla creazione E a ogni mutazione. Tutti gli endpoint lista+dettaglio restituiscono `operatoreId` + `operatoreCodice` non personale = `matricola ?? username`. Stampato su tutti e 3 i PDF + lista/export Interventi. Gli interventi sincronizzati da bolla ereditano l'operatore della bolla.

---

## Sicurezza, Accessi & Scoping

### Autenticazione & RBAC per area
- Sessione (username/password, bcryptjs). Aree: `generale/magazzino/sociale/logistica/analisi/amministrazione/uds`. I ruoli (`ruoli`) definiscono le `aree` permesse (jsonb string[]) + `isAdmin`. Gli utenti (`utenti`) hanno `nome`+`cognome` (col nullable ma richiesto in creazione), un ruolo, `matricola` opzionale.
- **Seed admin** (`admin`/`flocap!`, `mustChangePassword=true`) idempotente allo startup (`lib/seedAdmin.ts`). Cambio password forzato anche server-side: `requirePasswordChange` ritorna 403 su ogni route protetta finché `mustChangePassword`, permettendo solo `/auth/me`, `/auth/change-password`, `/auth/logout`.
- La nav nasconde le aree non permesse (`hasArea`) ma il confine è il backend `areaGuard` (mappa segmento-route → area). CRUD Utenti + Ruoli solo admin (`requireAdmin`). Lockout ultimo-admin bloccato sia su mutazioni utente SIA su demote ruolo; self-delete bloccato.
- **Auto-logout per inattività (15 min)**: sessione server `rolling:true` + `cookie.maxAge=15min`; timer idle client (`lib/use-idle-logout.ts`) sloggia dopo 15 min senza interazione e lancia un keepalive (refetch `/auth/me`) al più una volta / 5 min mentre attivo.

#### Matricola autogen
- Vuota su `POST /utenti` → `initial(nome)+initial(cognome)+yy-SIGLA-NNNNNN` in maiuscolo (es. Mario Rossi inserito 2026, città Milano sigla MI → `MR26-MI-482910`).
  - `yy` = anno inserimento a 2 cifre; `SIGLA` = `citta.sigla` (2 lettere) o prime 2 lettere del nome città come fallback, `OO` per utenti globali (cittaId null); `NNNNNN` = 6 cifre random. Su collisione di matricola completa la PRIMA cifra diventa lettera (A, B, C…). Solo server-side, trimmato prima.
- Auto-generata anche in **edit** (`PATCH /utenti/:id`) quando l'utente resterebbe senza matricola (record legacy null / svuotato) — rispetta un valore esplicito, non sovrascrive mai uno esistente, usa l'anno di inserimento ORIGINALE (`dataCreazione`) + città effettiva post-update.
- `citta.sigla` è un campo editabile di 2 lettere nella pagina admin Città (maiuscolizzato server-side). Pulizia one-off: `pnpm --filter @workspace/scripts run bonifica:matricole`.

### Scoping per Centro di Ascolto
- Additivo all'RBAC per area, server-side (il lock FE è solo UX). Utente con `centroAscoltoId != null` → vede il proprio centro O i condivisi (`centro IS NULL`); null = globale. Helper in `lib/centroScope.ts`.
- Sorgenti scope: **colonna diretta** (beneficiari, scarichi, approvvigionamenti, fornitori, volontari, magazzini); **via beneficiario** (consegne, bolle, interventi); **via set magazzini visibili** (lotti, giacenze, movimenti, trasferimenti).
- I create auto-assegnano+bloccano il centro del chiamante; PATCH ri-valida le FK passate nel body (guardia IDOR) → 403 se fuori. Lo scoping `utenti` è volutamente STRETTO (solo proprio centro, NO shared/null). report/dashboard scoped via frammenti SQL. `prodotti` resta GLOBALE.

### Scoping per Città / Zona UDS
- Asse top-level (additivo a centro + aree). **Città** = confine di visibilità HARD (un operatore non vede mai persone di un'altra città). **Zona UDS** (municipio) sotto una città = preferenza SOFT (vede prima la propria zona, può filtrare tutta la città).
- Colonne: `utenti.cittaId` (nullable = super-admin globale) + `utenti.zonaUdsId` (nullable = tutte le zone); `centri_ascolto.cittaId`, `magazzini.cittaId`, `beneficiari.cittaId` + `beneficiari.zonaUdsId` + `beneficiari.soprannome`. Tabelle `citta` + `zone_uds` (FK `cittaId`).
- `/auth/me` espone `cittaId/cittaNome/zonaUdsId/zonaUdsNome`. Pagine CRUD admin **Città** + **Zone UDS** (area amministrazione). Il form Utenti ha un select Città + un select Zona UDS dipendente ("Tutte le zone" = null; zona disabilitata finché non si sceglie una città).
- I centri di ascolto hanno un select **Città** nel form admin (solo admin globali; gli scoped ereditano la propria città) — necessario perché il filtro Città in Pianificazione Consegne mostra i centri della città scelta.
- Gli helper di scoping vivono accanto a quelli centro (filtro città hard su col diretta / via beneficiario / via magazzini visibili); guardie IDOR su PATCH rispecchiano il pattern centro. `prodotti` resta globale.

### Canale persona (UDS / Centro / entrambi)
- UN solo record persona. `centroAscoltoId` valorizzato = membro centro; `zonaUdsId`/`uds` = UDS. Una persona può essere entrambi; visibile a entrambi gli staff.

---

## i18n (FULL GUI)

- App interamente traducibile in 6 lingue — it/es/en/fr/de/ar (arabo RTL). Select lingua nel footer della sidebar; scelta persistita in `localStorage` (`ms-lang`, default `it`).
- Basato su `i18next` + `react-i18next`. Setup nella DIRECTORY `src/lib/i18n/`: `index.ts` (init; fonde tutti i namespace in un unico namespace `translation`; riesporta `LANGUAGES`/`isRtl`/`applyDirection`), `languages.ts`, `namespaces/base.ts` (`common.*` + `nav.*` condivisi), un `namespaces/<page>.ts` per pagina che esporta `export const <ns> = { it, es, en, fr, de, ar } as const` con set di chiavi identici.
- `main.tsx` importa `./lib/i18n` PRIMA di `App`. L'arabo imposta `<html dir="rtl">` via `applyDirection()`. I `NAV_ITEMS` portano `key`/`groupKey` stabili → chiavi di traduzione.
- **Per estendere**: aggiungi un file namespace, registralo in `index.ts`, usa `useTranslation()`. Messaggi di validazione: costruisci gli schemi zod con factory dentro il componente (`makeXSchema(t)` + `useMemo`) — MAI `i18n.t()` a livello modulo per i messaggi di schema. Testo dentro i PDF (jspdf) e default di dati persistiti NON sono tradotti di proposito.

---

## Gotchas

- **Session storage**: il `table.sql` di `connect-pg-simple` NON viene incluso dal bundle CJS esbuild, quindi la session table è una normale tabella Drizzle (`userSessionsTable`, `user_sessions`, col sid/sess/expire) in `lib/db/src/schema/auth.ts` con `createTableIfMissing:false`.
- **Cookie auth** `SameSite=None;Secure` + `trust proxy 1` per l'iframe di preview cross-site. Per via di `SameSite=None`, una guardia CSRF Origin/Referer (da `REPLIT_DOMAINS`/`REPLIT_DEV_DOMAIN`) gira su tutte le richieste `/api` non-GET/HEAD — i POST curl devono inviare `-H "Origin: https://$REPLIT_DEV_DOMAIN"` o ricevono 403.
- Dopo aver aggiunto file di schema a `lib/db`, esegui `pnpm run typecheck:libs` PRIMA di controllare l'API server o gli export delle nuove tabelle mancano.
- `db.execute(sql\`...\`)` ritorna un `QueryResult` — accedi a `result.rows`.
- Le colonne decimali tornano come stringhe — `parseFloat()` prima di inviare al client.
- Quando passi `enabled` alle opzioni `query` di un hook Orval, passa anche `queryKey` o TS dà errore.
- I nomi template della bolla PDF (`standard|moderno|minimal`) vivono in 4 posti (colonna DB, enum OpenAPI, API `VALID_TEMPLATES`, mappa `ACCENT` del PDF frontend) — cambiali in lockstep + ri-esegui codegen.
- Le route di `centri-ascolto` NON validano il body con Zod (fanno spread di `req.body`); per esporre un nuovo campo aggiungilo a `CentroAscoltoInput`/`Update` nell'OpenAPI + codegen, altrimenti i tipi FE generati lo rifiutano.

## Pointers

- Vedi la skill `pnpm-workspace` per struttura del workspace, setup TypeScript e dettagli dei package.
</content>
</invoke>
