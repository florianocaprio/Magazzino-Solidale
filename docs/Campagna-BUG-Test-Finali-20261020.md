# Campagna BUG — test finali e integrazione

20 ottobre 2026. Stato: **VERIFICA IN CORSO; MERGE CONDIZIONATO AI GATE**.

Floriano ha approvato esplicitamente tutti i punti 01–08 e ha richiesto i test finali 09, la ricompilazione personale 8082 e il merge diretto dopo esito positivo. Il mandato attuale copre l’integrazione Git; il rilascio Hetzner del distinto prompt 10 resta fuori da questa esecuzione.

- Branch: `codex/bugfix-uat-ottobre-2026`; base/main remoto `f668b7e0563af9004ef793947b45bc7ede94de1b`.
- Codice usato nell’ultima UAT sulla 8082: `fb2ba4b57c2ab01ea06b0546356cb824b6a8fb80`, ricevuta BUG20 collegata dal registro. HEAD iniziale `8b63c38307b163bf8431ddc5db118faebaf12971`: aggiunge soltanto documentazione.
- Main non avanzato; nessun conflitto rilevato o risolto. Workflow qualità su PR/main, nessun deploy; zero webhook, nessuna protezione classica o ruleset su main. Le protezioni non vengono alterate.
- Inventario: 170 file API, 8 gruppi; 49 suite browser. CI: job statico/Docker, API completo e quattro partizioni browser indipendenti. Localmente API e browser rispettano il lock condiviso.
- Cinque migration append-only della campagna: volontari Area, Enti globali, codici Beneficiari, anagrafica lotti produttore, servizi Beneficiari; tutte già presenti sulla 8082, ledger 63/63. Nessuna nuova migration prevista dai test o dal merge.
- Quattro documenti locali preesistenti non tracciati restano esclusi e preservati per SHA-256. File `.env`, credenziali, originali FSE, screenshot, log e backup non vengono committati.

## Gate

Install frozen e codegen canonico eseguiti; diff dei generated invariato. Risultati completi, eventuali correzioni, SHA/PR/run CI, equivalenza del candidato, ricevuta della nuova 8082 ed esito del merge verranno registrati al termine. Nessun gate futuro è presentato come PASS.

Evidenze locali private con prefisso `/private/tmp/bug09-`; CI pubblica soltanto log/JSON sanificati secondo il workflow, senza screenshot, trace o credenziali sintetiche.
