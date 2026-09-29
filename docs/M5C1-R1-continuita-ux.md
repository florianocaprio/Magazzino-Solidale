# M5C1-R1 — continuità UX Intervento → Pianificazione → Richiesta

**Stato:** implementata nel working tree; in attesa del separato `##test` e della validazione manuale.

## Base e causa

- Branch `codex/magazzino-workflow-unificato`, HEAD locale/remota `52e04c820ea57d77687c63352572b03cc87971bb`, divergenza `0/0`, working tree iniziale pulito.
- `origin/main` era ed è `787d7c5436d5fa4c0edb24be373d055946d402ce`; il `main` locale era già `8419dc7ff9d5177c39d90e66f04b19236021244d` al preflight e non è stato modificato o riallineato.
- Dopo la creazione, `Interventi` invalidava le query e chiudeva il form, ma lasciava la vista e i filtri precedenti e non selezionava l'ID restituito dall'API. Un Intervento creato da `Annullati` risultava quindi nascosto e non apriva il dettaglio.
- Il cambio filtri riscriveva l'URL senza `interventoId`; anche l'apertura dalla lista non aggiungeva il deep-link. La navigazione non conservava quindi il contesto del dettaglio.

## Decisione e comportamento

- Alla creazione `da_pianificare` si seleziona **Da pianificare**; alla creazione `pianificato` si seleziona **Pianificati**. In entrambi i casi il form si chiude, il dettaglio del nuovo ID si apre e l'URL porta `interventoId`.
- Dopo `Pianifica` da `da_pianificare`, solo se update e transizione riescono, si passa a **Pianificati** mantenendo il dettaglio e il deep-link. La chiusura del pannello lascia la vista coerente.
- La messa a fuoco usa l'elenco e azzera ricerca, tipo, priorità, operatore, stato, ambito legacy e intervallo date che potrebbero escludere il record. **Area Operativa e Centro restano invariati.** Il cambio di altri filtri mentre il dettaglio è aperto conserva `interventoId`.
- Il menu distingue `Registra intervento da pianificare` (senza data/ora) da `Pianifica nuovo intervento` (con data/ora), con descrizioni già tradotte; aggiornate le etichette delle lingue supportate. Gli stati di dominio non cambiano.
- La sezione esistente **Richiesta al Magazzino** rimane nel dettaglio sia prima sia dopo la pianificazione. Nessuna Richiesta viene creata automaticamente; l'invio resta una scelta esplicita. Nessuna sincronizzazione automatica della data è stata aggiunta.

## File modificati

- `artifacts/magazzino-solidale/src/pages/interventi.tsx`: focus dopo create/transizione, deep-link e menu.
- `artifacts/magazzino-solidale/src/lib/interventi-sociali-filters.ts`: normalizzazione dei soli filtri non territoriali.
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/interventi.ts`: etichette del menu.
- `artifacts/magazzino-solidale/src/pages/interventi-r1.test.tsx`, `src/lib/interventi-sociali-filters.test.ts`, `src/components/intervento-sociale-detail-sheet.test.tsx`: regressioni mirate.
- `artifacts/magazzino-solidale/e2e/m5c1-centro-richiesta.spec.ts`: percorso reale R1 nelle cinque viewport, oltre ai casi M5C1 preesistenti.
- `artifacts/magazzino-solidale/vitest.unit.config.ts`: inclusione dei test pagina.
- Questo rapporto.

Nessuna modifica a backend, OpenAPI, schema, migration 45, stock, M4 o RBAC. Nessun file generato modificato.

## Prove di sviluppo

| Prova                                              | Esito                                                     |
| -------------------------------------------------- | --------------------------------------------------------- |
| Frontend mirato (pagina, filtri, form e dettaglio) | PASS                                                      |
| Frontend completa                                  | 85 file, 452 PASS                                         |
| E2E M5C1 completo con nuovo scenario R1            | 15/15 PASS; mobile 390, tablet 768/1024/820, desktop 1440 |
| API completa sul solo PostgreSQL effimero          | 129 file, 1.473 PASS, 4 skip storici                      |
| Typecheck workspace                                | PASS                                                      |
| Build Linux API/WEB dal working tree               | PASS; `pnpm install --frozen-lockfile` nelle build        |
| Prettier e `git diff --check`                      | PASS                                                      |

Il primo `pnpm install --frozen-lockfile` locale si è fermato prima di modificare le dipendenze per `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`; le due build Docker effimere hanno eseguito con successo lo stesso install congelato. Il primo avvio della suite API non aveva i flag di sicurezza `M5A/M5B/M5C1_TEST_DISPOSABLE_DB` ed è stato interrotto; il rerun con i flag e lo stesso DB temporaneo è verde. I primi due run del nuovo E2E hanno isolato solo locator/gesti del test (`Escape` non deterministico e testo Appuntamento ambiguo); corretti nel test senza modificare l'applicazione. Il rerun finale di tutti i 15 casi è verde.

## Ambiente e limiti

L'E2E ha usato PostgreSQL 16 su tmpfs senza volumi, API, WEB e browser su una rete temporanea dedicata. Tre container, rete e due immagini M5C1-R1 sono stati eliminati nominativamente; verifica finale per label: nessuna risorsa R1 residua. Lo stack Docker persistente non è stato ricreato né raggiunto dai test; i suoi container mantenevano gli stessi ID prima e dopo la pulizia. Non è stato eseguito alcun deploy.

La creazione diretta `pianificato` e l'obbligatorietà data/ora sono coperte dai test frontend; il nuovo scenario browser copre la creazione `da_pianificare` e la transizione. La prova manuale di Floriano e il separato `##test` R1 restano da eseguire. Nessun commit, staging, push o merge; `main` invariato; M5C2 non iniziata.
