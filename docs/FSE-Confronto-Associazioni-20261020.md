# FSE+ — associazioni suggerite e confronto beneficiari

Richiesta UAT del 20 ottobre 2026: proporre i prodotti già presenti nel Catalogo e mostrare i dati del beneficiario registrato accanto a quelli importati, con scelte esplicite di collegamento/aggiornamento, creazione o esclusione della riga. Nessun prompt successivo avviato.

## Comportamento

- Prodotti: fino a tre proposte attive, ordinate per somiglianza nominativa. Normalizzazione di accenti, maiuscole, separatori, preposizioni e ripetizioni; numeri e formati restano nel confronto. Nome, codice e unità visibili. Un clic conferma la singola associazione con il comando già esistente e i suoi controlli di permesso/versione. Nessuna associazione viene salvata soltanto perché proposta. Resta la selezione manuale e la creazione con nome precompilato.
- Beneficiari: nome, cognome, codice e nascita registrata sui candidati del Centro. Tabella Dati registrati / Dati nel file FSE+, con campi differenti evidenziati e indicazione di aggiornamento o conservazione. Se esistono più candidati, il confronto è espandibile per ciascuno.
- Il file ElencoFascicoliSociali non contiene date di nascita: la colonna importata mostra “Non presente nel file”, senza ricostruzioni arbitrarie. La nascita interna viene conservata, come nome e cognome interni.
- “Collega e aggiorna FSE+” associa al candidato consentito ed esegue il merge conservativo già presente: completa la presa in carico mancante, aggiorna il Fascicolo e i conteggi non autorevoli, conserva nucleo anagrafico completo e canale di consegna verificato. Il medesimo calcolo alimenta anteprima e scrittura. Un candidato con altro Fascicolo già assegnato è segnalato e non collegabile.
- “Crea nuovo” resta una scelta esplicita per i possibili duplicati. “Salta questa riga” evita scritture sia su anagrafica sia su Fascicolo, produce esito `saltato`, conteggio `saltati` e numeri di riga nell’audit del batch; consente una successiva importazione della riga. Per un Fascicolo già noto si può mantenere l’aggiornamento previsto o saltare; i conflitti territoriali/nominativi non vengono uniti automaticamente.
- Perimetro invariato: i dati personali dei candidati fuori dal Centro selezionato non vengono esposti; rimangono warning e scelte Crea nuovo/Salta. Nessun trasferimento di beneficiario fra Centri.
- Corretto l’overflow del dialogo su telefono con Area/Centro e codici lunghi. Sei lingue aggiornate. Nessun cambio di stack o dipendenze.

## Impatto

**Nessuna modifica allo schema DB e nessuna migrazione.** Estensione additiva OpenAPI: confronto di campi, identità dei candidati consentiti, collegabilità, risoluzione `salta` ed esito/conteggio delle righe saltate. Client React e tipi/Zod rigenerati esclusivamente con `pnpm --filter @workspace/api-spec run codegen`; replay identico su 989 file. I conteggi degli esclusi non richiedono colonne: esito nella risposta e righe saltate nell’audit del batch.

## Verifiche realmente eseguite

- `CI=true pnpm install --frozen-lockfile`: PASS, lockfile invariato. Cache offline incompleta; installazione completata con accesso al registro npm autorizzato.
- `pnpm run typecheck`: PASS.
- Interfaccia: **794 PASS**, 124 file. Proposte pertinenti, formati/ordinamento, prodotti inattivi e coincidenze numeriche; confronto e scelta esplicita nell’interfaccia.
- Runner API isolato, gruppi `general emporio`, con i tre Excel reali: **1.552 PASS / 2 SKIP** generale, **230 PASS** Emporio. I due SKIP sono i campioni legacy AGEA non forniti. Verificati confronto con nascita non presente nel file, merge conservativo, perimetro, esclusione senza modifiche, successivo collegamento e esclusione di aggiornamenti su Fascicolo esistente.
- Browser finale: **15 PASS** Beneficiari sui cinque viewport; **11 PASS / 19 SKIP** M3B, compresi proposta con associazione diretta, import dei due Excel originali e replay senza doppio stock. I 19 SKIP sono i limiti preesistenti della matrice viewport.
- Prima prova browser: 14 PASS / 1 FAIL per overflow di 50 px sul telefono con nomi lunghi. Corretto il contenitore e ripetuta l’intera verifica: nessun controllo indebolito, stesso input lungo e limite di 1 px.
- Tutti gli import di prova su PostgreSQL temporanei del runner, successivamente rimossi. Nessun workbook, screenshot, log, token o backup aggiunto ai commit. Quattro documenti locali preesistenti preservati con SHA-256.

Evidenze private: `/private/tmp/fse-review-api`, `/private/tmp/fse-review-browser-final`, `/private/tmp/fse-review-ui.log`, `/private/tmp/fse-review-typecheck.log`, `/private/tmp/fse-review-codegen-replay.log`.

## File modificati

- `artifacts/api-server/src/routes/beneficiari-fse.ts`
- `artifacts/api-server/tests/beneficiari-fse-api.test.ts`
- `artifacts/magazzino-solidale/e2e/fse-beneficiari-import.spec.ts`
- `artifacts/magazzino-solidale/e2e/fse-import-practice-m3b.spec.ts`
- `artifacts/magazzino-solidale/src/components/beneficiari-fse-ui.test.tsx`
- `artifacts/magazzino-solidale/src/components/fse-beneficiari-actions.tsx`
- `artifacts/magazzino-solidale/src/components/fse-beneficiari-comparison.tsx`
- `artifacts/magazzino-solidale/src/components/fse-import-practice-wizard.tsx`
- `artifacts/magazzino-solidale/src/lib/fse-product-suggestions.test.ts`
- `artifacts/magazzino-solidale/src/lib/fse-product-suggestions.ts`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/blocco07.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/beneficiariFseComparisonField.ts`
- `lib/api-zod/src/generated/types/beneficiariFseComparisonFieldEsito.ts`
- `lib/api-zod/src/generated/types/beneficiariFseDuplicateCandidate.ts`
- `lib/api-zod/src/generated/types/beneficiariFseImportDetailEsito.ts`
- `lib/api-zod/src/generated/types/beneficiariFseImportResolutionAzione.ts`
- `lib/api-zod/src/generated/types/beneficiariFseImportResult.ts`
- `lib/api-zod/src/generated/types/beneficiariFsePreviewRow.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `docs/FSE-Confronto-Associazioni-20261020.md`: resoconto e ricevuta installazione.
- `docs/campagna-bug-2026-10.md`: versione corrente della 8082.

## Ricevuta della 8082

Codice installato **`01d463f658888ab5b22098de9f168ccab92b836e`**, compilato da `git archive` del commit verificato. API e WEB realmente ricreati; PostgreSQL conserva container, avvio e volume.

| Servizio | Immagine | Image ID |
| --- | --- | --- |
| /magazzino-api | `magazzino-bugfix-uat-api:sha-01d463f65888` | `sha256:80a21603d41dadb731ad0dfb33a2da607002bcb4f065635c92a72875d92affea` |
| /magazzino-web | `magazzino-bugfix-uat-web:sha-01d463f65888` | `sha256:d330fbee6c3f4e4291b3b69cf6793f750fecf99a8fc69adb4771cf2655489bb8` |

- Backup privato: `/Users/florianocaprio/Backups/Magazzino-Solidale/FSE-REVIEW-01d463f65888-2026-10-20T09-53-39-602Z`. Database e uploads, directory 0700 / file 0600; ripristino realmente provato su PostgreSQL isolato senza porte o volumi personali, replay migrazioni **62 → 62**. Override di rilascio e rollback conservati nel backup.
- **43 tabelle: hash di tutte le colonne invariati** prima/dopo ripristino e installazione. Nessun import di prova sul database personale, nessuna nuova variazione dei Beneficiari al riavvio.
- Ledger effettivo **62/62**, nessun pending, checksum difforme, file mancante o fuori ordine.
- `/`, `/config.js`, `/api/healthz`, `/api/readyz`: **200**. `/api/utenti` anonimo: **401**.
- Entry servita `/assets/index-DBucM36N.js`. Asset Carico Merce `carico-merce-DDQvv_ww.js` e Beneficiari verificati per SHA-256 contro l’immagine compilata, inclusa presenza dei testi di proposta prodotto, confronto, collegamento e riga saltata. Conservati i controlli su Enti/Fornitori globali e sulle funzioni dei Carichi già chiuse.
- Build e budget PASS: Initial entry index-DBucM36N.js: 1392.3 KiB, 386.8 KiB gzip.
- Ricaricare la pagina della 8082 per usare il nuovo JavaScript. Per i prodotti verificare le proposte nel passaggio Controlla e associa; per i beneficiari confrontare il candidato e selezionare Collega e aggiorna FSE+, Crea nuovo oppure Salta questa riga, quindi confermare l’importazione. UAT da confermare con Floriano; nessun prompt successivo avviato.
