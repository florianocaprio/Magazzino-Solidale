# M5C2-A-R1 — Sheet Richieste e annullamento orchestrato

Sviluppo del 6 ottobre 2026 sulla base `3a520f3665f7cdb44770f65de4ef6f25f58cf49c`, branch `codex/magazzino-workflow-unificato`. Preservato il candidato locale M5C2-A/R2.1, inclusi file non tracciati. Non è un collaudo formale né una validazione manuale. Il precedente `M5C2-A-test-report.md` resta immutato.

## Correzione UX e contratto

Il dettaglio era sotto la lista e l'annullamento con documento richiedeva due operazioni separate. Ora la lista compatta apre uno Sheet destro responsive, con intestazione fissa, corpo scrollabile e azioni in fondo. Il deep-link `richiestaId` è reattivo; la chiusura conserva gli altri parametri. Presa in carico e scelta del Magazzino/preparazione restano nello stesso pannello.

Dialog dedicato: motivo obbligatorio (500), nota opzionale (2000), avviso audit e annullamento del documento. La nota viene salvata nell'audit e mostrata nello storico, senza sovrascrivere `noteOperative`. Errori estratti da payload backend e fallback. Traduzioni IT/EN/ES/FR/DE/AR.

## Annullamento e integrità

- Senza documento: richiesta attiva annullabile secondo grant e scope correnti.
- Bolla: solo `bozza`/`confermato`, senza scarico fisico nel ledger.
- Trasferimento: solo `richiesto`/`preparato`, senza movimento di uscita.
- Dopo uscita/stato finale: rifiuto transazionale; UI spiega di usare esito/rientro e offre l'apertura del documento.
- Servizi M4 transazionali estratti in `m4Cancellation.ts` e riutilizzati sia dai comandi M4 diretti sia dalla Richiesta. Nessuna chiamata HTTP tra route, nessun secondo motore stock.
- Nella stessa transazione: autorizzazione corrente, lock coerenti Richiesta/link/documento, annullamento M4, rilascio prenotazioni, cessazione link, annullamento Richiesta. Audit correlati con chiavi distinte, incremento versione Richiesta una sola volta, receipt idempotente.
- Centro richiedente o Magazzino che ha preso in carico: grant `richieste_magazzino.cancel` e perimetro corrente; non è imposto un ulteriore grant M4 cancel al comando orchestrato. Replay dopo revoca negato.
- Intervento originale preservato; nuova Richiesta successiva verificata. Semantica legacy non collegata mantenuta.

Nessuna modifica schema/migration. OpenAPI estesa additivamente con `nota`; client/Zod rigenerati dal comando ufficiale.

## File R1

- API: `src/lib/m4Cancellation.ts` (nuovo), `src/lib/m5bDocumentLink.ts`, route `richieste-magazzino.ts`, `bolle.ts`, `trasferimenti.ts`.
- Frontend: pagina `richieste-magazzino.tsx`, namespace i18n `richiesteMagazzino.ts`.
- Contratto: `lib/api-spec/openapi.yaml` e output generati client/Zod relativi al comando cancel.
- Test: nuovo `m5c2a-r1-request-cancel.test.ts`, nuovo test pagina `richieste-magazzino.test.tsx`, E2E `richieste-magazzino-m5a.spec.ts`, nuovo `m5c2a-r1-sheet-real.spec.ts`; aggiornato il solo assert storico che imponeva il vecchio annullamento M4 separato in `richieste-magazzino-m5b.test.ts`.
- Questo rapporto. Tutto il restante delta M5C2-A/R2.1 preesistente è conservato.

## Prove di sviluppo

- API mirata: **19/19 PASS**, 13 R1 e 6 M5C2-A. Include no-documento/bozza/confermata, audit, note, stock, prenotazioni, limiti input, revoche, Centro/Area, trasferimento preparato, replay concorrente e race contro conferma/partenza.
- Frontend completa finale: **88 file, 464 test PASS**, inclusi quattro test Sheet.
- Typecheck workspace finale: **PASS**.
- E2E Sheet con autenticazione reale e risposte Richieste mockate: **10/10 PASS**, cinque viewport. Corretto solo un confronto subpixel del test mobile tramite arrotondamento.
- E2E desktop con backend e PostgreSQL reali: **1/1 PASS**. Crea fixture sintetica nell'effimero, prepara/conferma Bolla, verifica coda Bolle pronte, annulla da Sheet con motivo/nota; controlla Bolla/Richiesta/link, stock 10 invariato, zero movimenti/prenotazioni attive e Intervento originale ancora `da_pianificare`. Verifica rimozione dalla coda. Primo tentativo del test rifiutato correttamente per Origin mancante; harness corretto aggiungendo Origin reale, senza disabilitare CSRF.
- Build Linux API e WEB: **PASS**, Dockerfile ufficiali e immagini effimere dedicate. WEB budget **380,6 KiB gzip / 400 KiB**.
- Codegen deterministico: seconda esecuzione con fingerprint invariata `c2b70bb922bcc94e69bda50e945b30b60c92479ea9bba9ee55b0117052aff408`.
- `pnpm install --frozen-lockfile --offline`: abortito senza rimozione di node_modules per richiesta conferma senza TTY; non forzato. Installazione prevista dalle build Linux riuscita.

La prima suite API completa R1 ha prodotto 1489 PASS, 9 FAIL, 4 SKIP. Una failure era il vecchio assert cancel=409 incompatibile con il nuovo requisito R1: sostituito con una verifica dello stato attivo, mantenendo il resto del test M4 diretto e coprendo separatamente il nuovo comando. Otto failure erano già documentate nel precedente rapporto M5C2-A: sei R3 (`B/G/ADMIN/D/PLAN/RACE`) e due M5B (`LEDGER-DIRECT/RETURN`) usano consegna/affidamento diretti della Bolla sociale invece del nuovo handoff Centro, ottenendo 409. Non sono stati trasformati in PASS cambiando indiscriminatamente gli assert. Logistica passa in questo run.

Il percorso umano M5C2-A completo fino alla consegna non è coperto dal solo nuovo E2E di annullamento: rimane da completare nel separato collaudo formale, insieme alla riconciliazione delle regressioni storiche. Non si dichiara PASS globale.

Suite API finale single-worker, dopo l'adeguamento dell'assert storico: **1489 PASS, 9 FAIL, 4 SKIP (1502)**. Le otto failure M5B/R3 restano; l'assert cancel aggiornato passa. Compare inoltre `socket hang up` nel caso terminali immutabili di `audit-centro-ascolto-hardening.test.ts`. Diagnostica successiva isolata sullo stesso DB, insieme ai test R1 e M5C2-A: **3 file / 30 test PASS**; questo non cancella la failure del run completo e non ne dimostra ancora la causa. Un tentativo diagnostico con filtro CLI non applicato è stato interrotto; nessun risultato di quel tentativo è usato come evidenza. I quattro skip della suite completa sono preesistenti, non introdotti da R1.

Prettier sui file R1 e `git diff --check`: PASS. La sola formattazione successiva di due test non modifica fixture o assert.

Evidenze fuori repository: `/private/tmp/m5c2a-r1-api-20261006.json`, `/private/tmp/m5c2a-r1-api-final-20261006.log`, `/private/tmp/m5c2a-r1-api-final-20261006.json`, log frontend/typecheck e directory E2E `m5c2a-r1-*20261006`.

## Ambiente e consegna

Solo ambiente effimero R1: PostgreSQL 16 con tmpfs e nessun volume, database `m5c2a_r1` con ledger 46; API/WEB Linux dedicate. Nessun accesso al DB persistente, nessun rebuild/deploy persistente. Le credenziali sintetiche dei test non sono credenziali di altri ambienti.

Cleanup verificato: rimossi i container `magazzino-m5c2a-r1-dev-db-20261006`, `magazzino-m5c2a-r1-test-api-20261006`, `magazzino-m5c2a-r1-test-web-20261006`, la rete `magazzino-m5c2a-r1-test-net-20261006` e le immagini `magazzino-m5c2a-r1-test-api:20261006`, `magazzino-m5c2a-r1-test-web:20261006`, `magazzino-m5c2a-r1-test-web-build:20261006`. Il container one-shot budget era già rimosso automaticamente. Nessun volume temporaneo creato. Le credenziali del DB effimero rimosso non danno più accesso a un'istanza attiva. Conservati i report diagnostici in `/private/tmp`, esclusi dal repository.

Verifica Docker finale: restano i container persistenti con gli stessi ID (`magazzino-web` ad4578e60527, `magazzino-api` d376cbbd766b, `magazzino-postgres` af6bd975d17d); rete e volumi persistenti preservati. Le risorse preesistenti di altre milestone/progetti non sono state eliminate.

Nessuno staging, commit, push, merge. Main non modificato. Working tree intenzionalmente sporco, comprensivo di tutto il candidato precedente e del delta R1.

HEAD e tracking branch remoto restano `3a520f3665f7cdb44770f65de4ef6f25f58cf49c`; staging vuoto. Non è stato eseguito fetch/push. `main` locale `8419dc7ff9d5177c39d90e66f04b19236021244d`, `origin/main` `787d7c5436d5fa4c0edb24be373d055946d402ce`.

**M5C2-A-R1 RICHIESTE SHEET/CANCEL IMPLEMENTATA NEL WORKING TREE — IN ATTESA DI ##test.**
