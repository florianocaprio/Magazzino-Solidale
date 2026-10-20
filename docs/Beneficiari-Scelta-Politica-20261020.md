# Beneficiari — scelta esplicita della politica Credito

Correttivo UAT del 20 ottobre 2026. Codice installato sulla 8082: **`291af99f3f40933d4fe7711c00d542a25875b04c`**.

Il menu **Politica per questo beneficiario** è ora dentro **Credito mensile suggerito**, nella posizione della politica che prima compariva solo come testo nella schermata indicata da Floriano. Mostra le politiche attive utilizzabili per il Centro, l’Area e quelle globali. Senza una scelta registrata presenta **Seleziona la politica da applicare** e Applica politica resta disabilitato fino alla selezione; il menu non propone più il valore Automatica. Se la scelta è già registrata, viene mostrata alla riapertura.

Scegliere la politica e premere **Applica politica** la associa alla persona usando l’API già presente. La creazione successiva di un’altra politica non sostituisce quella assegnata. La selezione aggiorna il calcolo e la quota non manuale; quote manuali, saldo e movimenti restano conservati. Non sono cambiate le regole di autorizzazione o di territorio. I calcoli e dati preesistenti senza una scelta esplicita restano compatibili finché l’operatore non applica una politica: nessuna assegnazione massiva automatica.

Intervento limitato al frontend e alla prova browser esistente. Nessun cambio a schema, migrazioni, OpenAPI, client generati, dipendenze o lockfile.

## Validazione

- `CI=true pnpm install --frozen-lockfile`: PASS con rete disponibile; lockfile invariato. Il primo tentativo nella sandbox non raggiungeva npm. I controlli avviati prima del completamento delle dipendenze non sono contati come validazione: ripetuti dopo l’installazione riuscita.
- `pnpm run typecheck`: PASS.
- UI: **796 PASS**, 124 file.
- Browser: **30 PASS**, cinque viewport. Verificati menu nel riquadro del credito, placeholder e Applica disabilitato senza scelta, politica globale e Area disponibili, altra Area esclusa, applicazione, riapertura e mantenimento della politica scelta dopo l’inserimento di una nuova globale. Quota 21 e saldo 0 nella prova sintetica; overflow entro 1 px e screenshot mobile ispezionato.
- API: **1561 PASS / 2 SKIP**, 144 file, runner ufficiale `node scripts/quality-gates-run.mjs api general`, che esegue Vitest del pacchetto api-server. I due SKIP sono i campioni legacy AGEA non forniti. Nessuna modifica al backend; verifiche conservate su politica, ambito territoriale, quote e import FSE+ con i quattro file reali disponibili.
- Test su PostgreSQL temporanei, rimossi al termine; nessuna importazione o creazione di politiche di prova nel DB personale della 8082.

Evidenze private: `/private/tmp/policy-dropdown-browser-verified`, `/private/tmp/policy-dropdown-api`, `/private/tmp/policy-dropdown-typecheck-verified.log`, `/private/tmp/policy-dropdown-ui-verified.log`.

## Ricevuta 8082

- API: `magazzino-bugfix-uat-api:sha-291af99f3f40`, ID `sha256:65875490078fccb661a3a254c73354e0299aa4e6460860a5f8989d433f10c908`.
- WEB: `magazzino-bugfix-uat-web:sha-291af99f3f40`, ID `sha256:8127443cfee646be9b7b2f1a70fe432ef86d274b49e605e5e7c9c85f7e7f9a3a`.
- Immagini compilate da archivio Git. Ricreati API e WEB; PostgreSQL conserva container, avvio e volumi.
- Backup DB/uploads `/Users/florianocaprio/Backups/Magazzino-Solidale/POLICY-DROPDOWN-291af99f3f40-2026-10-20T15-14-51-705Z`, ripristinato realmente su PostgreSQL isolato; replay migrazioni **63 → 63** senza variazioni.
- Ledger **63/63**, nessun pending, checksum difforme, file mancante o fuori ordine. **45 tabelle confrontate su tutte le colonne: hash invariati**, inclusi Beneficiari, quote, saldi, politiche e movimenti Credito.
- HTTP root/config/health/ready 200; Utenti anonimo 401. Entry `/assets/index-BXj1L2b_.js`. Asset serviti confrontati con l’immagine per SHA-256 e presenza del nuovo selettore verificata. Conservati i correttivi precedenti e il limite Nginx di 10 MB.
- Budget: Initial entry index-BXj1L2b_.js: 1393.5 KiB, 387.2 KiB gzip.

Nessun deploy Hetzner o merge su main. Nuova scelta da validare con Floriano; nessun prompt successivo avviato.

## File modificati

- `artifacts/magazzino-solidale/src/pages/beneficiario-dettaglio.tsx`
- `artifacts/magazzino-solidale/src/components/beneficiario-credito-policy.tsx`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/creditoSolidale.ts`
- `artifacts/magazzino-solidale/e2e/fse-beneficiari-import.spec.ts`
- `docs/Beneficiari-Scelta-Politica-20261020.md`
- `docs/campagna-bug-2026-10.md`

Quattro documenti locali preesistenti preservati con SHA-256 invariati ed esclusi. Nessun dato personale, credenziale, log, screenshot o file FSE+ committato.

Per la prova: ricaricare la 8082, aprire Modifica anagrafica e cercare Credito mensile suggerito. Aprire Politica per questo beneficiario, selezionare e premere Applica politica. Riaprire la scheda e verificare la scelta conservata.
