# M5C2-A-R2 — ##test separato: FAIL

Data: 6 ottobre 2026. Candidato: `d211f41c691756ecc11bf746a7e4305d35cd8335` + working tree R2 preesistente + un solo test di regressione aggiunto durante questa fase. Nessun codice applicativo, schema, migration, generato o configurazione del persistente modificato.

## Preflight e inventario

- Branch `codex/magazzino-workflow-unificato`; HEAD locale e tracking remoto coincidenti alla SHA attesa, divergenza `0/0`; staging vuoto. `main` locale e tracking remoto osservati alle rispettive SHA preesistenti (`8419dc7f...` e `787d7c54...`), senza modificarli.
- Il rapporto di sviluppo R2 è stato letto integralmente. Il working tree iniziale contiene **15 file tracciati modificati + 7 file nuovi = 22**, non i 23 citati nel prompt di test. L'impronta dei 21 file applicativi/test/contratto del rapporto di sviluppo corrispondeva all'ingresso; il ventiduesimo era il rapporto di sviluppo. Dopo il test aggiunto, **20/21** impronte restano coincidenti e il solo file di test aggiornato differisce come previsto. Nessun file candidato mancante è stato individuato nell'inventario Git.
- Nessuna migration nuova né modifica allo schema DB; nessun file staged. Il test aggiunto in questa fase è soltanto in `artifacts/api-server/tests/m5c2a-handoff-bolla-pronta.test.ts`.

## Ambiente effimero

Creato solo `magazzino-m5c2a-r2-formal-db-20261006` (PostgreSQL 16, storage `tmpfs`, nessun volume, porta `127.0.0.1:58261`). Schema fresh applicato con `pnpm --filter @workspace/db push` e ledger ufficiale registrato con `pnpm --filter @workspace/db run update`: **46/46**. Il primo container, inizialmente senza rete, è stato arrestato e rimosso prima di ricrearlo con accesso esclusivamente localhost. Nessun accesso al database o ai container persistenti.

## Prova mirata e finding bloccante

Il file API R2 esistente, prima del nuovo caso, passa **7/7** sul DB effimero.

Nuovo caso: Bolla collegata confermata, pianificata e completata via API reale; Richiesta riportata allo stato storico `presa_in_carico`; `inspectRequestClosure()` la classifica correttamente `candidata`. Si modifica poi **solo nella fixture sintetica** `richieste_magazzino.area_operativa_id` verso una seconda Area, mentre Bolla, magazzino, destinatario e Consegna restano nella prima Area. Il piano read-only dovrebbe escludere la relazione territorialmente incoerente, come richiesto da G6.

Esito del test mirato: **1 FAIL**, 7 test non eseguiti per il filtro di selezione. `inspectRequestClosure()` restituisce ancora `esito: "candidata"`, non `"esclusa"` (`tests/m5c2a-handoff-bolla-pronta.test.ts`, caso “non propone una riconciliazione se l'Area della Richiesta non coincide con quella della Bolla”). La funzione confronta tipo e identità del destinatario, ma non verifica la coerenza fra Area della Richiesta e Area del magazzino della Bolla. Il piano diagnostico può quindi proporre una riconciliazione di dati con scope incoerente. Questo è un **difetto applicativo R2** relativo a G6; non è stato corretto, in osservanza del divieto di modificare codice applicativo durante `##test`.

Un comando iniziale con sintassi Vitest errata (`pnpm ... run test -- ...`) aveva avviato la suite intera, anziché il file mirato. È stato interrotto e sostituito con `pnpm ... exec vitest run tests/m5c2a-handoff-bolla-pronta.test.ts ...`. Cinque failure parziali di `cassa-emporio` emerse prima dell'interruzione **non costituiscono un risultato di suite completa né sono riconciliate**.

## Stato gate

| Gate                      | Esito                                   | Motivo                                                       |
| ------------------------- | --------------------------------------- | ------------------------------------------------------------ |
| G1 Git/candidato          | Verificato con discrepanza di conteggio | 22 file candidati osservati, contro 23 dichiarati nel prompt |
| G6 riconciliazione legacy | **FAIL**                                | Scope Area incoerente classificato `candidata`               |
| G2–G5, G7–G10             | **NE**                                  | Arresto immediato imposto dal prompt dopo bug applicativo    |

Non sono stati eseguiti la suite API completa finale, frontend completa, E2E, build Linux, budget, codegen o la matrice integrale degli stati. Gli skip storici (quattro, documentati nel rapporto di sviluppo) non sono stati rivalutati in questo `##test` interrotto. Nessun PASS formale o validazione manuale dichiarata.

## Piano read-only per eventuali casi reali

Il comando diagnostico R2 opera per allowlist esplicita di ID e target confermato, in transazione read-only. Prima di un suo eventuale uso sul persistente serve un mandato separato; il difetto G6 va prima corretto e ritestato. Un censimento futuro dovrebbe prima individuare, in sola lettura, richieste `presa_in_carico` con Bolla corrente `consegnato`, verificarne Area/magazzino, destinatario, Consegna e movimenti, poi produrre una lista di ID consentiti e il piano minimizzato. **Nessun conteggio reale è stato misurato in questa fase.** Nessun apply o riconciliazione persistente è stato eseguito.

## Cleanup e Git

Il container temporaneo è stato arrestato e rimosso nominativamente. Le verifiche finali filtrate per prefisso R2 non mostrano container, volumi o reti dedicati residui. I tre container persistenti (`magazzino-web`, `magazzino-api`, `magazzino-postgres`) restano attivi e non sono stati modificati. Nessun commit, push, merge o deploy. Working tree R2 preservato con il solo nuovo test e questo rapporto; staging vuoto. M5C2-B e M6 non avviati.

**M5C2-A-R2 — ##test FAIL — CORREZIONI NECESSARIE.**
