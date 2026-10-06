# M5C2-A/R2.1 — collaudo finale interrotto (NO-GO)

Data: 6 ottobre 2026. Esito: **FAIL tecnico; candidato non pubblicato; Docker persistente non ricompilato**. Questo non è un collaudo manuale.

## Candidato e preflight

- Branch: `codex/magazzino-workflow-unificato`.
- HEAD locale e `origin/codex/magazzino-workflow-unificato`: `3a520f3665f7cdb44770f65de4ef6f25f58cf49c`.
- `origin/main`: `787d7c5436d5fa4c0edb24be373d055946d402ce`.
- Staging iniziale vuoto; working tree M5C2-A/R2.1 intenzionalmente modificato, inclusi i file non tracciati. Nessun reset, clean, stash, pull o rebase.
- Nessuna migration 47 o modifica schema introdotta dal candidato.

Docker Desktop inizialmente non rispondeva; l'avvio autorizzato tramite `open -a Docker` ha reso disponibile il daemon 29.5.3. Docker Desktop ha avviato automaticamente anche i tre container persistenti preesistenti; non sono stati ricreati, interrogati come database, ricompilati o modificati da questo collaudo.

## Ambiente effimero e prove eseguite

È stato creato il solo container `magazzino-m5c2a-test-db-20261006` con PostgreSQL 16, porta localhost assegnata 49591, dati in `tmpfs` e **nessun volume montato**. Il database di test è indipendente da quello persistente. Un primo tentativo di eseguire direttamente il runner su schema vuoto è stato respinto dalla migration iniziale perché mancava il bootstrap dello schema; sul database fresh separato nello stesso container è stato quindi eseguito il bootstrap previsto per un DB nuovo, seguito dal runner ufficiale: **46 migration applicate, 0 pendenti**. Nessuna migration è stata applicata al persistente.

Il primo run del nuovo test API M5C2-A ha fallito per due assert errati del solo harness: una query restituiva una lista invece del primo lotto e il movimento di consegna veniva cercato come `uscita` anziché come `scarico/consegna_beneficiario`. Corretti soltanto questi due assert, senza modifiche applicative; il rerun è **6/6 PASS**.

La suite API completa single-worker sul PostgreSQL effimero ha prodotto **127 file PASS, 3 file FAIL; 1476 test PASS, 9 FAIL, 4 SKIP**. Le failure sono:

- `m5b-r3-guardie-post-preparazione.test.ts`: 6 casi R3 (`R3-B`, `R3-G`, `R3-ADMIN`, `R3-D`, `R3-PLAN`, `R3-RACE`) attendono ancora che comandi diretti M4 su una Bolla collegata a Richiesta con destinatario beneficiario siano accettati. Il candidato ora restituisce 409 con la regola esplicita secondo cui la Bolla sociale deve essere pianificata dal Centro. Va riconciliato il contratto dei test storici con M5C2-A, preservando una regressione reale dei permessi R3; non è lecito cambiare indiscriminatamente gli assert da 200 a 409.
- `richieste-magazzino-m5b.test.ts`: `LEDGER-M5B-DIRECT` e `LEDGER-M5B-RETURN` attendono consegna/affidamento diretti della Bolla sociale collegata. Ricevono 409 per la stessa regola di handoff del Centro. La copertura di contabilità e rientro M5B va mantenuta con fixture/flusso coerente col nuovo contratto.
- `logistica-hardening.test.ts`: la prova concorrente su mezzo/slot ha ottenuto `[200,404]` invece di `[200,409]`; il successivo cleanup della fixture ha incontrato una FK residua in `turni_volontari`. Causa non ancora accertata; non è classificata come PASS né ignorata come flake.

I quattro skip sono storici, non aggiunti in questo collaudo. Il run completo è **NO-GO**; non sono stati avviati gli altri gate (frontend completo, E2E M5C2-A e M5C1-R2, build Linux API/WEB, budget WEB, codegen finale, typecheck finale, Prettier finale). Non si riutilizzano esiti precedenti per dichiararli superati. Nessun dato di prova è stato creato nel persistente.

## Esito e prossima fase

Il prompt impone la pubblicazione e il rebuild persistente soltanto con tutti i gate PASS. Pertanto **nessun staging, commit, push, merge, backup deploy o rebuild** è stato eseguito. Il working tree M5C2-A/R2.1 resta intenzionalmente non committato, con la sola correzione del nuovo test e questo rapporto aggiunti durante `##test`.

Cleanup completato: il container effimero è stato fermato e rimosso automaticamente (`--rm`); non restano container, reti o volumi Docker M5C2-A. Prettier sui due file toccati durante questo collaudo e `git diff --check` sono verdi. HEAD locale/remoto e `origin/main` restano quelli del preflight; lo staging resta vuoto.

Per riprendere serve riconciliare i test M5B/R3 con il nuovo handoff senza indebolire le garanzie storiche, chiarire la failure Logistica, completare la copertura E2E umana e rieseguire tutti i gate sul medesimo candidato. La validazione manuale non è stata eseguita.

**M5C2-A — ##test FAIL — NON PUBBLICATA, DOCKER PERSISTENTE NON TOCCATO.**
