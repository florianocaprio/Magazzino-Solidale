# M4B.2 — esiti dello sviluppo candidato

Stato: **`DEV-M4B.2/NE-TEST/NE-MAN`**. Base locale/remota verificata prima
delle modifiche: `98835207ed047dd764633b234ba91f87738c296b`, branch
`codex/magazzino-workflow-unificato`, index e working tree inizialmente
puliti. Questo rapporto non è il verbale del separato `##test M4`.

## Contratto applicato

- Bolla pronta: percorso diretto M4A oppure affidamento che converte gli
  impegni in uscite fisiche; la consegna dopo affidamento è un `esito` neutro
  sulla giacenza, ma è fatto finale di distribuzione/Consegna quando dovuto.
- Mancata consegna o mancato arrivo: stato `rientro_atteso`, nessun movimento
  fisico. Una sola riconciliazione finale per owner, su partite derivate dai
  movimenti reali, con versione/idempotenza/audit nella stessa transazione.
- Magazzino di rientro fisso all'origine. Quantità esatte per uscita. Classi
  ammesse: idonea, deteriorata, scaduta, mancante, rubata; `altro` respinta.
- Idonea: `+Q` sul lotto originario. Deteriorata/scaduta: `+Q` di rientro e
  `-Q` tramite Scarichi esistente, stesso lotto e stessa transazione.
  Mancante/rubata: evento/documento anomalia `esito` a effetto fisico zero.
- `rientrato` è terminale per Bolla e Trasferimento. Il PDF di
  riconciliazione è derivato dalle righe persistenti; i documenti di scarto
  sono Scarichi reali identificabili con ID.

## Persistenza, autorizzazione e reporting

La migrazione additiva 42 crea testata e righe di rientro, owner esclusivo,
unicità per owner, FK composte per documento/uscita/prodotto/lotto e trigger
che richiede l'uscita fisica corretta nel Magazzino origine. Nessuna tabella
legacy è riscritta. L'attore/ruolo/scope sono riletti dal database dopo il
lock del documento per i comandi nuovi; la medesima finalizzazione serve
Bolle e Consegne. Il segno fisico canonico dipende da tipo e dettaglio del
movimento (non dalla natura contabile); report as-of e riconciliazioni
usano tale proiezione. Il fatto contabile `DISTRIBUZIONE_FINALE` resta
distinto dall'affidamento di custodia e può riferirsi a un `esito` neutro.

## Prove di sviluppo eseguite

| Prova                                       | Esito                                                                                                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh DB 42/42, seed, smoke, replay, verify | PASS sul PostgreSQL disposable M4B.2.                                                                                                                                 |
| Suite API completa                          | 119 file, 1353 pass, 4 skip; `SESSION_SECRET` sintetico di test.                                                                                                      |
| Frontend unit completa                      | 77 file, 415 pass; incluso PDF derivato per singola classe.                                                                                                           |
| Test mirati M4B.2                           | Bolla diretta/affidata, Ente, rientro misto, scaduta/rubata, Trasferimento, FEFO multi-partita, concorrenza affidamento/rientro, revoca/scope durante lock, FK owner. |
| Runner migrazioni con PostgreSQL            | 24 pass, 0 fail, 0 skip.                                                                                                                                              |
| Typecheck workspace                         | PASS; rieseguito dopo l'ultima modifica UI.                                                                                                                           |
| OpenAPI codegen                             | PASS; SHA-256 identici prima/dopo la rigenerazione su 852 file generated.                                                                                             |
| Build API                                   | PASS.                                                                                                                                                                 |
| Build workspace nativa macOS                | Non verde: modulo nativo `lightningcss.darwin-arm64.node` assente, problema ambientale già registrato in M4B.1. La build compatibile resta al separato `##test M4`.   |

La prima esecuzione API senza `SESSION_SECRET` aveva quattro file non
avviabili; con la variabile sintetica il rerun completo è verde. Il primo
fresh ha trovato la collisione del nome di un vincolo già creato dal
bootstrap Drizzle: la migrazione 42 ora verifica la presenza del vincolo,
poi il fresh 42/42 e il replay sono verdi. Il runner aveva un'aspettativa
storica di 41 file: aggiornata puntualmente a 42 senza cambiare il
manifest dei 21 legacy; runner PostgreSQL verde.

`pnpm install --frozen-lockfile` è stato tentato, ma pnpm ha richiesto
conferma interattiva per ricreare `node_modules` ed è terminato con
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`; non è stata forzata la
rimozione delle dipendenze locali. I test e il typecheck sopra usano le
dipendenze già disponibili nel workspace.

## Pendenze esplicite

Il separato `##test M4` dovrà congelare un unico candidato, ripetere le
suite/gate formali, il build in ambiente compatibile, la prova di upgrade
popolato 41→42, E2E/UI e la review completa dei report/permessi. La
validazione manuale non è stata eseguita; `NE-MAN-CAMERA` e
`NE-MAN-TABLET` restano non eseguiti. Nessun commit, push, merge o
aggiornamento del Docker persistente fa parte di questa fase.

## Inventario del delta non pubblicato

55 file nel working tree (34 modificati, 21 nuovi; nessuno staged). Percorsi
relativi alla radice del repository:

- API, modificati: `artifacts/api-server/src/lib/{bollaDelivery,fseCanonicalReporting,fseReconciliation,scaricoInventory}.ts`, `artifacts/api-server/src/lib/reporting/{fsePlus,logistica}.ts`, `artifacts/api-server/src/routes/{bolle,consegne,lotti-logici,trasferimenti}.ts`, `artifacts/api-server/tests/scope-helpers.ts`.
- API, nuovi: `artifacts/api-server/src/lib/{currentCommandActor,movementPhysicalEffect,transportReturn}.ts`, `artifacts/api-server/tests/transport-return-m4b2.test.ts`.
- Frontend, modificati: `artifacts/magazzino-solidale/src/lib/{bolla-pdf,trasferimento-pdf}.ts`, `artifacts/magazzino-solidale/src/lib/i18n/index.ts`, `artifacts/magazzino-solidale/src/pages/{bolle,consegne}.tsx`.
- Frontend, nuovi: `artifacts/magazzino-solidale/src/components/transport-return-panel.tsx`, `artifacts/magazzino-solidale/src/lib/{transport-return,transport-return-pdf,transport-return.test,transport-return-pdf.test}.ts`, `artifacts/magazzino-solidale/src/lib/i18n/namespaces/transportReturn.ts`.
- DB, modificati: `lib/db/scripts/migration-runner.test.mjs`, `lib/db/src/schema/{bolle,index,movimenti,trasferimenti}.ts`; nuovi: `lib/db/src/schema/rientriTrasporto.ts`, `lib/db/updates/20260924_m4b2_rientri_trasporto.sql`.
- Contratto, modificato: `lib/api-spec/openapi.yaml`; generated modificati: `lib/api-client-react/src/generated/{api,api.schemas}.ts`, `lib/api-zod/src/generated/api.ts`, `lib/api-zod/src/generated/types/{bolla,bollaDettaglio,index,trasferimento}.ts`; generated nuovi: `lib/api-zod/src/generated/types/{affidaBollaInput,mancatoTrasportoInput,rientroTrasportoDettaglio,rientroTrasportoDocumento,rientroTrasportoDocumentoTipo,rientroTrasportoInput,rientroTrasportoPartita,rientroTrasportoRigaInput}.ts`.
- Documentazione, modificata: `docs/magazzino-workflow-unificato/{AMBIENTE_TEST,AVANZAMENTO,DECISIONI,MATRICE_VALIDAZIONE,PROGETTO_M4}.md`; nuovo: questo `ESITI_SVILUPPO_M4B2.md`.

## Verifica successiva

Questo rapporto conserva i risultati della fase di **sviluppo** e il suo
inventario iniziale di 55 file; non è riscritto come se quei test fossero
la validazione formale. Il separato `##test M4` e le correzioni emerse sono
documentati in `ESITI_TEST_M4.md`. L'identità del candidato finale va letta
in quel verbale, non nell'inventario di ingresso riportato sopra.
