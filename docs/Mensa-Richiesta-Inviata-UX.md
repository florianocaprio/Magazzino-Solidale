# Mensa — Conferma invio e stati delle richieste

## Perimetro e candidato

13 ottobre 2026. Branch `codex/magazzino-workflow-unificato`, HEAD invariata
`535e5a403fd7eb0d940256de2dc34ce67f7b0166`. Nessuno staging, commit o push.
Preservato integralmente il delta precedente della preferenza del magazzino
di approvvigionamento, inclusa migration 55, e i documenti locali estranei.

L'utente ha autorizzato, dopo i test, la ricompilazione e ricreazione del solo WEB
sulla 8082. API, PostgreSQL e preview 8083 non devono essere ricreati.

## Comportamento corretto

Il precedente callback azzerava i campi dopo il salvataggio ma lasciava visibile
il modulo vuoto con un messaggio generico. Ora il risultato positivo del server
mostra una conferma persistente «Richiesta inviata», con codice della richiesta,
al posto del modulo. Non è una conferma ottimistica: compare solo dopo il
successo del comando. Il riepilogo torna a pagina 1 e viene aggiornato dai dati
canonici del server. Un eventuale errore di aggiornamento non ripete il comando
già riuscito e non cancella la conferma dell'invio.

La conferma scompare al clic sul riquadro Area Operativa, anche quando il
selettore è disabilitato dall'assegnazione territoriale, al clic sulla conferma
stessa o sul pulsante «Nuova richiesta al Magazzino». Cambiando menu il componente
viene smontato e la conferma non viene conservata. Le interazioni con l'Area non
azzerano le bozze non salvate; restano le guardie esistenti sui cambi di contesto.

Il riepilogo usa badge testuali, non solo il colore:

- INVIATA: blu.
- PRESA IN CARICO: ambra.
- COMPLETATA: verde.
- ANNULLATA: grigio.

Precisazione semantica: il backend esclude i trasferimenti dalla chiusura
amministrativa automatica delle richieste. Per la Mensa, una richiesta presa in
carico con documento **corrente** di tipo trasferimento e stato **completato**
è presentata come COMPLETATA. Non viene scritto `chiusa` nel database. Un
trasferimento in transito, storico/non corrente, stornato, o un documento di
altro tipo non produce questa presentazione. Una richiesta annullata resta
ANNULLATA. Non cambiano stock, quantità, permessi o motore M4.

## File di questo correttivo

- `artifacts/magazzino-solidale/src/components/mensa-rifornimenti.tsx`
- `artifacts/magazzino-solidale/src/components/mensa-rifornimenti.test.tsx`
- `artifacts/magazzino-solidale/src/components/mensa-operational-context.tsx`
- `artifacts/magazzino-solidale/src/components/mensa-operational-context.test.tsx`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/mensa.ts`
- `artifacts/magazzino-solidale/e2e/mensa-magazzino-correttivo.spec.ts`
- Questo rapporto.

Il confronto dei manifest con il candidato già installato per la preferenza
magazzino conferma che sono cambiati esclusivamente i sei file frontend/test
sopra indicati: backend, schema, migration, contratti, generated e dipendenze
sono invariati rispetto a quel candidato. Non confondere questo delta con tutte
le modifiche già presenti rispetto a HEAD.

## Verifiche e storia dei tentativi

Evidenze: `/private/tmp/magazzino-mensa-inviata-RqFhZeFa`.

| Verifica finale                                                | Risultato                                   | Evidenza                                      |
| -------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------- |
| Suite frontend completa                                        | 627 PASS, 0 FAIL, 0 SKIP; 105 file          | `frontend-group.log`                          |
| API Mensa/Magazzino mirate, single-worker, PostgreSQL effimero | 11 PASS, 0 FAIL, 0 SKIP                     | `api-target.log`, `api-target.result.json`    |
| E2E Mensa e correttivo, cinque viewport                        | 13 PASS, 0 FAIL, 12 SKIP storici, 0 flaky   | `mensa-final.log`, `browser-mensa-final.json` |
| Typecheck completo                                             | PASS                                        | `typecheck-group.log`                         |
| Build WEB nativa                                               | PASS                                        | `web-build-group.log`                         |
| Build WEB Linux amd64                                          | PASS                                        | `confirmation-final-web-build.log`            |
| Budget WEB                                                     | PASS: 1402,0 KiB; gzip 388,2 KiB            | comando `build:budget` sul bundle finale      |
| Prettier sui sei file e rapporto; diff check                   | PASS                                        | controllo finale                              |
| DB browser effimero                                            | 55/55, zero pending, nessun checksum errato | `mensa-final-after-ledger.json`               |

Le cinque viewport sono 390×844, 768×1024, 1024×768, 820×1180, 1440×900.
Il percorso reale richiesta → presa in carico → trasferimento → ricezione,
con verifica delle quantità e assenza di doppio movimento, passa in tutte.
Sono controllati conferma, rimozione del modulo, richiesta nel riepilogo,
colori dei tre stati e chiusura della conferma tramite Area.
I 12 skip sono le tre prove storiche desktop-only di `mensa-workflows.spec.ts`
sulle quattro viewport non desktop: replay consumo, persona temporanea/pasto,
R2-04 lotto reale. Le tre prove sono PASS su desktop. Nessuno skip nuovo.

La prima esecuzione typecheck ha rilevato chiavi EN duplicate dallo spread IT:
corretto l'ordine dello spread e rieseguita la verifica completa con successo.
La prima campagna E2E è stata interrotta dopo timeout sul clic dell'etichetta
Area Operativa: Playwright la associava al combobox correttamente disabilitato
e attendeva che diventasse abilitato. Trace e failure restano in `browser-mensa`
e `formal-browser-mensa.log`. Il contenitore Area ha ora un nome/ruolo semantico
di gruppo e il test clicca quel riquadro con interazione ordinaria. Nessun
`force`, attesa fissa, retry o indebolimento degli assert. L'intero gruppo è
stato rieseguito con successo, con evidenze separate `mensa-final`.

Coperti anche: permanenza della conferma dopo refresh, errore refresh successivo
al salvataggio, ritorno a pagina 1, dismissione/cambio menu, preservazione bozze,
completamento solo da documento corrente ricevuto e casi negativi.

Non rieseguita la suite API globale per questo delta esclusivamente frontend;
non si presenta il precedente risultato globale come nuova esecuzione.
Nessun aggiornamento delle dipendenze: utilizzate quelle installate e la build
Linux con pipeline canonica frozen-lockfile. L'installazione offline nel percorso
locale non è stata completata poiché richiedeva la ricreazione di node_modules
senza TTY; nessun lockfile o dipendenza modificato per aggirare il limite.

## Installazione WEB 8082

Fingerprint del contesto finale, esclusi documenti e file privati:
`3160a750941db0d526f898064f20726ba68bf601a4fb9855355af95c0c59648b`.

- Immagine nuova: `magazzino-mensa-inviata-web:confirmation-final`.
- ID nuovo: `sha256:e575418e88ed8bea1a178b85ad5f5c5d58f39ff6d7f04ab39330cdbcaf1d2f04`.
- ID WEB precedente conservato: `sha256:16a007ddeb7fe567df557338b981457f25a5f16d3ce60c1d945318f76698a955`.
- Solo `magazzino-web` ricreato con Compose esistente, `--no-build --no-deps`.
- Identità, immagine e avvio di `magazzino-api`, `magazzino-postgres` e dei tre
  container preview 8083 verificati identici prima/dopo.
- Volumi `magazzino-solidale_magazzino_pgdata`,
  `magazzino-solidale_magazzino_uploads` e rete `magazzino-solidale_default`
  invariati. Nessun accesso diretto al DB persistente, nessuna migration,
  nessuna creazione di dati di prova sulla 8082.
- HTTP 200: `/`, `/login`, `/mensa/trasferimenti`, `/config.js`,
  `/api/healthz`, `/api/readyz`. Il bundle effettivamente servito contiene la
  nuova conferma. Immagine del container in esecuzione uguale a quella compilata.

Override Compose durevole, manifest, log e risultato:
`/Users/florianocaprio/Backups/Magazzino-Solidale/Mensa-Inviata-WEB-2026-10-13T082641-500Z`.
Questa directory contiene evidenze dell'aggiornamento WEB, non un nuovo dump DB.
I backup DB/uploads del precedente rilascio restano conservati e non modificati.

## Risorse effimere e consegna

Creati per i test tre PostgreSQL auto-remove su tmpfs:

- `magazzino-mensa-inviata-rqfhzefa-58631`
- `magazzino-mensa-inviata-rqfhzefa-58461`
- `magazzino-mensa-inviata-rqfhzefa-58621`

Cleanup nominativo, senza prune: container di test rimossi e credenziali
temporanee eliminate; nessun volume/rete Docker di test creato.
Conservati immagine WEB attualmente installata e precedente immagine per
rollback. Nessuna operazione su main, nessun commit/push.

Pronto per prova manuale su `http://127.0.0.1:8082/mensa/trasferimenti`.
Se il browser mantiene la vecchia pagina, ricaricare la scheda. La UAT dell'utente
resta da eseguire: i test automatici non vengono dichiarati validazione manuale.
