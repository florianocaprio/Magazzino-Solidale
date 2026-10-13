# Mensa — preferenza del magazzino di approvvigionamento

## Decisione e perimetro

Floriano ha confermato: **preferenza modificabile dal Magazzino**, non origine obbligatoria.
Base: `535e5a403fd7eb0d940256de2dc34ce67f7b0166`, branch
`codex/magazzino-workflow-unificato`.

Nella nuova richiesta Mensa si selezionano Area, Mensa e magazzino richiesto.
La selezione è esplicita e obbligatoria per le nuove richieste Mensa; non vengono
preselezionati automaticamente tutti i magazzini, né imposti prodotti o lotti.
Il bisogno resta testo libero. L'invio della richiesta non movimenta stock.

La lista contiene soltanto magazzini attivi dell'Area scelta, diversi dal deposito
della Mensa e accessibili secondo lo scope Centro/Area esistente. La verifica
dell'assegnazione Mensa corrente e dei permessi resta server-side. Il server
rivalida il magazzino al momento dell'invio, anche se il client ha dati cached.
Errori di caricamento, lista vuota e campo obbligatorio mancante sono distinti.

Nel dettaglio della richiesta il Magazzino vede la preferenza originale e la trova
precompilata nell'origine, se ancora disponibile. Può scegliere un'altra origine
autorizzata prima di preparare il trasferimento. Il documento M4 registra l'origine
effettiva; la richiesta conserva la preferenza iniziale per non riscrivere lo storico.
FEFO, prenotazioni, preparazione, spedizione e ricezione restano nel motore M4.

## Schema e contratto

- Migration append-only 55: `20261013_z_mensa_magazzino_richiesto.sql`.
- Due colonne nullable su `richieste_magazzino`: `magazzino_richiesto_id` (FK
  `magazzini`, delete restrict) e `magazzino_richiesto_nome_snapshot`.
- Check di coerenza della coppia, solo per richieste Mensa e diversa dalla
  destinazione; trigger di immutabilità dopo l'invio. Nessun backfill legacy.
- `POST /richieste-magazzino`: `magazzinoRichiestoId`, obbligatorio nel ramo Mensa,
  non ammesso per richieste non Mensa. Il nome snapshot è derivato dal server.
- DTO Richiesta: ID richiesto e nome snapshot, nullable per lo storico.
- `GET /mensa/logistica/magazzini`: filtri opzionali `areaOperativaId` e `mensaId`;
  quando si indica la Mensa l'Area deve essere coerente.
- OpenAPI autorevole; client React e Zod rigenerati dalla pipeline canonica.

Non sono cambiate le migration 1–54 né i permessi, i seed o la contabilità.
Il codice precedente non persisteva alcuna preferenza di origine nella richiesta:
aggiungere soltanto un selettore senza queste estensioni avrebbe perso la scelta
prima della preparazione da parte del Magazzino.

## File del delta

- UI: `artifacts/magazzino-solidale/src/components/mensa-rifornimenti.tsx`,
  `src/pages/richieste-magazzino.tsx`, `src/lib/i18n/namespaces/mensa.ts`.
- Backend: `artifacts/api-server/src/routes/mensa.ts` e
  `artifacts/api-server/src/routes/richieste-magazzino.ts`.
- Schema e migration: `lib/db/src/schema/richiesteMagazzino.ts` e
  `lib/db/updates/20261013_z_mensa_magazzino_richiesto.sql`.
- Contratto: `lib/api-spec/openapi.yaml`.
- Generated canonici: `lib/api-client-react/src/generated/api.ts`,
  `api.schemas.ts`; `lib/api-zod/src/generated/api.ts`, `types/index.ts`,
  `types/richiestaMagazzino.ts`, `types/richiestaMagazzinoCreate.ts`,
  nuovo `types/listMagazziniMensaParams.ts`.
- Test: `artifacts/api-server/tests/mensa-magazzino-correttivo.test.ts`,
  `artifacts/magazzino-solidale/src/components/mensa-rifornimenti.test.tsx`,
  `artifacts/magazzino-solidale/e2e/mensa-magazzino-correttivo.spec.ts`.
- Questo rapporto. I sei documenti locali di rilascio M6.2/M6.3/M6.4 preesistenti
  restano estranei al delta e sono preservati.

## Verifiche di sviluppo

Evidenze locali: `/private/tmp/magazzino-mensa-preferenza-nv0Q49mM`.

- API mirate iniziali: 122 PASS, 0 FAIL (Mensa, raccordo e contratto migration).
- Upgrade autentico 54→55: schema e runner estratti dalla SHA base, popolamento
  sintetico a ledger 54, snapshot pre/post uguali, preferenze legacy null, replay
  senza riapplicazioni e parità semantica con fresh 55/55.
- API completa finale single-worker su database fresh dedicati: **1.853 PASS,
  0 FAIL, 0 SKIP**, 145 file (`formal-api.json` / `formal-api.log`).
  Include gli 11 test del raccordo Mensa: preferenza obbligatoria, origine fuori
  Area/inattiva/destinazione respinta, sessione corrente e scope Centro, replay,
  immutabilità del nome/ID e preparazione da un'origine alternativa.
- Frontend completa finale: **616 PASS**, 105 file, zero failure/skip
  (`frontend-final.log`), inclusi errore con cache, lista vuota e campo rosso.
- Browser Mensa: **13 PASS, 0 FAIL, 12 SKIP storici** (`browser-mensa.json`).
  Il nuovo scenario completo passa in tutte e cinque le viewport; 5 prove di layout
  e 3 workflow storici desktop completano i 13 PASS. I 12 SKIP sono le repliche
  non-desktop dei 3 workflow preesistenti limitati al desktop; nessun nuovo skip.
- Browser continuità Richiesta/Bolla: **10 PASS, 0 FAIL, 0 SKIP** nelle cinque
  viewport (`browser-m5.json`). API e browser mai sovrapposti: lock canonico e DB
  distinti, con database delle prove mirate preservati prima della suite fresh.
- Runner PostgreSQL: **24/24 PASS**, zero skip (`runner-final.log`).
- Typecheck completo, codegen ripetuto deterministico, Prettier sui soli file del
  delta e `git diff --check`: PASS. Nessun cambiamento al lockfile.
- Build WEB nativa e budget: PASS, entry 1401,4 KiB / 387,9 KiB gzip.
- Build Linux API e WEB: PASS dal contesto congelato, senza avvio/deploy delle
  immagini. ID API `sha256:84a6f1786bebedb6bcfae2a36995a4c0c2647ad3c6238d0480c209c87844e851`;
  WEB `sha256:da495dd98073a0c99939fbe7ca10df9be381284fec9f19a8fae28a5c5957729a`.

Il manifest `supplier55-context-manifest.json` identifica 2081 file di input
(documentazione e file locali esclusi), verificati identici al working tree dopo
la build. Fingerprint SHA-256:
`3359a275fcd8ed02fbe27cf511dc3fdea946a3a96914d20ba983a83feea608e7`.

L'installazione locale `pnpm install --frozen-lockfile --offline` si è fermata con
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`: non è stata forzata la ricostruzione
di `node_modules`. I controlli nativi usano le dipendenze esistenti con i binari
macOS già predisposti, senza cambiamenti a lockfile o policy multipiattaforma.

## Cleanup e Git finale

Rimossi nominativamente i container PostgreSQL `--rm` con tmpfs:

- `magazzino-mensa-preferenza-nv0q49mm-58631`
- `magazzino-mensa-preferenza-nv0q49mm-58461`
- `magazzino-mensa-preferenza-nv0q49mm-58621`

Rimosse anche le immagini di verifica `magazzino-mensa-preferenza-api:supplier55`
e `magazzino-mensa-preferenza-web:supplier55`. Nessun volume o network creato,
nessun prune. File credenziali effimere eliminato; evidenze conservate nella
directory temporanea indicata. Nessun database fresh/copia/test rimasto attivo.

HEAD locale/remota invariata `535e5a403fd7eb0d940256de2dc34ce67f7b0166`, staging
vuoto, working tree modificato con questo candidato e i sei documenti estranei
preservati. `main` remoto verificato in sola lettura:
`787d7c5436d5fa4c0edb24be373d055946d402ce`. Nessun commit/push/merge/deploy.

## Rilascio e prova manuale

Modifica consegnata nel working tree, non costituisce pubblicazione o UAT superata.
La migration è stata applicata esclusivamente su PostgreSQL effimeri.
Docker 8082/8083, database e volumi persistenti non sono stati modificati.
Prima di rendere disponibile questa versione sulla 8082 serve un rilascio protetto
con backup e applicazione della migration 55.

UAT da effettuare dopo il rilascio: dalla Mensa scegliere un magazzino, inviare il
bisogno; dal Magazzino verificare la preferenza e selezionare una diversa origine
prima della preparazione. Verificare che il dettaglio conservi la scelta originale
e il trasferimento riporti quella effettiva.
