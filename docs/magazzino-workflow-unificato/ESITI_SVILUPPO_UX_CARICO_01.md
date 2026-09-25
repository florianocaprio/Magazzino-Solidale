# UX-CARICO-01 — esiti dello sviluppo candidato

Stato: **`DEV-UX-CARICO-01/NE-TEST-UX/NE-MAN`**. Branch
`codex/magazzino-workflow-unificato`, base locale/remota verificata
`d96680eeee82b2b5a4690602534168623826b544`. Nessuno staging, commit,
push o deploy fa parte di questa fase. Il documento locale non tracciato
`DEPLOY_PERSISTENTE_M4.md`, già presente in ingresso, è stato conservato
senza modifiche.

## Delta funzionale

- L'azione principale è **Conferma carico a magazzino**. La conferma mostra
  Magazzino destinazione, singoli prodotti e quantità/unità; soltanto le
  righe esplicitamente selezionate, salvate e valide vengono contabilizzate.
- Gli errori di testata, riga, registrazione e creazione raccolta restano
  visibili presso il rispettivo contesto fino alla correzione, al nuovo
  tentativo o al cambio di contesto pertinente. I primi campi problematici
  sono raggiunti con focus, con messaggi e `aria-invalid`.
- **Salva bozza** segnala subito i campi obbligatori/invalidi. Una riga
  incompleta consentita dal dominio può comunque essere salvata come bozza,
  ma resta riconoscibile come incompleta e non è registrabile. Una bozza
  invalida non viene presentata come salvata.
- Sotto il selettore del lotto logico è disponibile **+ Nuova raccolta /
  attività**: crea un lotto logico nell'Area corrente e lo seleziona nella
  pratica, senza attribuire un codice lotto fisico. Gli errori della dialog
  non spariscono da soli e i dati inseriti restano disponibili per il retry.
- Dopo il salvataggio di una riga, il refetch riconcilia le bozze per riga:
  le modifiche locali alle altre righe sono preservate. Un conflitto sulla
  stessa riga viene segnalato e non sovrascritto silenziosamente. Le
  modifiche non salvate alla testata bloccano la conferma del carico.
- Le stringhe sono disponibili nelle sei lingue già supportate, compresi i
  contesti RTL. Nessun motore inventariale, schema, migrazione, route API,
  OpenAPI o file generated è stato modificato.

## Prove di sviluppo

| Prova                      | Esito                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit frontend completa     | **PASS**: 77 file, 418 test. Coperti validazione della riga, bozze, riconciliazione e stringhe i18n.                                                                                                                     |
| API mirata Carico          | **PASS**: 11 test M3A.                                                                                                                                                                                                   |
| API mirata policy/quantità | **PASS**: 10 test.                                                                                                                                                                                                       |
| API completa               | **PASS**: 119 file, 1376 pass, 4 skip preesistenti, con `SESSION_SECRET` sintetico e PostgreSQL disposable.                                                                                                              |
| E2E UX-CARICO-01           | **PASS**: desktop e tablet simulato. Campi richiesti, bozza incompleta, focus/errore persistente, selezione, conservazione A/B, raccolta con errore e retry, carico soltanto B, replay idempotente, giacenza e chiusura. |
| E2E regressione M3A        | **PASS**: 2 prove desktop; 2 skip tablet previsti dalla specifica del test storico.                                                                                                                                      |
| E2E regressione FSE M3B    | **PASS**: 3 prove; 2 skip previsti (fixture Excel originale assente e progetto tablet non pertinente).                                                                                                                   |
| Typecheck workspace        | **PASS**, rieseguito dopo la correzione del focus.                                                                                                                                                                       |
| Build Linux API e WEB      | **PASS**, con `pnpm install --frozen-lockfile` nel build isolato; warning di dimensione chunk WEB già noto.                                                                                                              |

La prima suite API completa senza `SESSION_SECRET` aveva quattro file non
avviabili e un errore intermittente di connessione nel test Cassa Emporio.
I cinque file sono stati riprovati con secret di test (97 pass), poi la
suite **intera** con lo stesso ambiente è risultata verde. Alcune prime
prove E2E hanno rilevato un locator troppo ampio, una fixture Area affollata
e il focus applicato prima della fine del refetch: locator/fixture e timing
del focus sono stati corretti; il browser finale desktop/tablet è verde.
Questi tentativi non sono conteggiati come passati.

`pnpm install --frozen-lockfile` sul macOS host è stato tentato, ma pnpm ha
interrotto la ricreazione di `node_modules` con
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`; non è stata forzata la
rimozione delle dipendenze locali. La build WEB nativa sul medesimo host
resta bloccata dal modulo già noto `lightningcss.darwin-arm64.node` assente;
la build Linux isolata è verde. I test e il typecheck host hanno usato le
dipendenze già presenti.

## Ambiente e limiti

Le prove DB/E2E hanno usato esclusivamente il candidato disposable
`magazzino-ux-carico-01-{db,api,web}-20260925` con rete
`magazzino-ux-carico-01-net-20260925` e immagini
`magazzino-ux-carico-01-{api,web}:dev`. Container, rete, immagini e volume
PostgreSQL anonimo del candidato sono stati rimossi nominativamente o con
`--rm`; nessun `prune` e nessuna modifica allo stack Docker persistente.

Non sono stati eseguiti il separato `##test UX-CARICO-01`, una prova
manuale, una prova con fotocamera reale o tablet fisico. La validazione
formale deve riprendere **questo** working tree, riesaminare il delta e
rieseguire i gate richiesti, senza considerare questo rapporto come
approvazione finale.

## Verifica successiva

Questo è il rapporto storico della fase di **sviluppo**. Il successivo
`##test UX-CARICO-01`, la validazione manuale dichiarata da Floriano e la
relativa chiusura sono registrati separatamente in
`ESITI_TEST_UX_CARICO_01.md`; non si devono leggere gli `NE-TEST`/`NE-MAN`
di ingresso come stato corrente della UX.
