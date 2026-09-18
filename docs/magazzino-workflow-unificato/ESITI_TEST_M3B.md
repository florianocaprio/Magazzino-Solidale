# M3B — Esiti test e decisione GO

Data: 18 settembre 2026

Branch: `codex/magazzino-workflow-unificato`

SHA iniziale: `ad76175a360794ceeb36a7024b1933ba5e6b2bba`

## Dataset originali

I file sono stati letti in sola lettura dai percorsi indicati da Floriano; non
sono stati copiati nel repository né modificati.

| File                                                                                                | SHA-256                                                            |  Dimensione | Riscontro                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Registro Feliciangeli_in_Moto_ODV_Dal_01-09-2024_Al_17-09-2026.xlsx`                               | `4e4b8ba724a35cb048d42070299c34b3ecfe673206390c8fde2d67c20488c901` | 22.855 byte | `Table1`, 19 colonne, 239 righe: 80 carichi, 158 distribuzioni, 1 reso; +24.216/−23.039 pezzi, saldo 1.177; date documento presenti e date carico magazzino vuote |
| `Giacenza Feliciangeli in Moto ODV al giorno 17_09_2026_escluse_DdCBozza_escluse_GiacenzaZero.xlsx` | `e1b4ab9c0b647adb0f3fb48bb4f0f76b493aee005933cb0a223a3218cba554de` |  4.105 byte | `Table1`, 15 colonne, 7 righe, totale 1.177 pezzi                                                                                                                 |

T01 e T25 sono stati realmente eseguiti. Il caso di precisione conserva il
lotto testuale `006544`; 53 pezzi × `0,321620` producono esattamente
`17,045860` kg. Le sette righe Giacenze, comprese la riga da 26 pezzi con zero
colli e le relative scadenze, sono state confrontate campo per campo.

Nel saldo reale lo stock resta zero dopo upload, confronto e associazione.
Solo `Registra` contabilizza 1.177 pezzi e attiva la copertura; le 239 righe del
Registro restano riferimenti storici e non generano 24.216 pezzi.

## Matrice T01–T35

| ID  | Esito   | Evidenza eseguita                                                                                                                     |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| T01 | OK      | Hash, dimensioni, fogli, 19/15 colonne e 239/7 righe verificati sui due originali                                                     |
| T02 | OK      | Date documento, carico nullo, fallback motivato, seriali 1900/1904 e date invalide/ambigue coperti dal parser                         |
| T03 | OK      | XLS BIFF8, XLSX e CSV BOM/separatori/quote/multilinea/virgola; firme false, corruzione e fogli ambigui respinti                       |
| T04 | OK      | `006544`, riga 26/0 colli e calcolo `53 × 0,321620 = 17,045860` verificati senza arrotondamenti                                       |
| T05 | OK      | Interi/frazionabili, override catalogo, fondi distinti e conversioni incompatibili verificati                                         |
| T06 | OK      | 80 carichi, 158 distribuzioni e 1 reso classificati; nessuno scarico operativo creato dal Registro                                    |
| T07 | OK      | Scadenza arricchita solo su match univoco; obbligatorietà e assenza di lotti produttore fittizi verificate                            |
| T08 | OK      | Reimport dello stesso contenuto, anche rinominato, idempotente; righe escluse riprendibili                                            |
| T09 | OK      | Riordino, intestazione/periodo e saldi diversi non duplicano identità già note                                                        |
| T10 | OK      | Documenti diversi nello stesso giorno e ingressi distinti dello stesso lotto restano separati                                         |
| T11 | OK      | Variazione 100→120 produce `DATO_MODIFICATO`, non un delta/carico automatico                                                          |
| T12 | OK      | Occurrence e righe indistinguibili richiedono disambiguazione senza somma arbitraria                                                  |
| T13 | OK      | Claim univoca per sorgente/identità anche fra pratiche e magazzini; sorgenti distinte restano indipendenti                            |
| T14 | OK      | Bozza/incompleta riconosciuta; annullamento non contabilizzato libera e audita; registrato/coperto resta claimed                      |
| T15 | OK      | Upload, associazione e registrazione concorrenti: replay coerente, payload incompatibile 409, una sola applicazione                   |
| T16 | OK      | Mapping, descrizione e barcode non cambiano l'identità esterna né riscrivono registrazioni passate                                    |
| T17 | OK      | Memoria AGEA applicata/assorbita riusata; casi non ricostruibili restano da verificare                                                |
| T18 | OK      | Associazione/creazione/mapping riusato e 403 senza `magazzino.products.manage`                                                        |
| T19 | OK-AUTO | Barcode manuale/generato, collisione e concorrenza; scanner negato/indisponibile conserva il draft. Fotocamera fisica `NE-MAN-CAMERA` |
| T20 | OK      | Solo righe valide aggiunte, escluse riprendibili; upload/associazione non creano stock o movimenti                                    |
| T21 | OK      | E2E UI/API reale fino a `Registra`, logout/login, stock esatto e reimport senza effetti                                               |
| T22 | OK      | Draft 5→8, due righe, testata/lotto/scadenza, sidebar/refetch, stale version e recupero verificati                                    |
| T23 | OK      | Scope Area/Centro, pratica/import altrui e revoca prima del replay respinti senza leakage                                             |
| T24 | OK      | Audit failure in associazione/registrazione ripristina claim, righe, stock e stati                                                    |
| T25 | OK      | Originali: 7 righe/1.177 pezzi; zero prima di `Registra`, inizializzazione singola dopo                                               |
| T26 | OK      | Riconciliazione bidirezionale Fondo/Prodotto/Lotto, pezzi e peso/volume; kg e L separati                                              |
| T27 | OK      | Copertura include eventi di lotti esauriti; reimport non crea movimenti                                                               |
| T28 | OK      | Ingresso post-taglio ammesso; evento retrodatato sconosciuto resta da riconciliare                                                    |
| T29 | OK      | Secondo saldo, stock/storia anche a zero, ambito/date incompatibili e cross-magazzino bloccati                                        |
| T30 | OK      | Concorrenza con writer, applicazione integrale, rollback audit e replay innocuo                                                       |
| T31 | OK      | Snapshot Giacenze successivo è solo confronto, senza delta, overwrite o cancellazioni                                                 |
| T32 | OK      | Numero/data documento restano per riga; gruppi distinti contabilizzati una volta                                                      |
| T33 | OK      | Writer legacy e M3B concorrenti, anche cross-magazzino, non aggirano lock/claim                                                       |
| T34 | OK      | M3A 80+20, M2 quantità/lotti/trasferimenti, M1B Area/inattivi e M1C audit coperti nel run combinato e nella suite completa            |
| T35 | OK      | Limiti, ZIP anomali/path traversal, macro/contenuto attivo ed errori controllati; nessun `CodiceAccesso` esposto                      |

La copertura è automatica e di integrazione/E2E; non viene presentata come
validazione umana. Restano `NE-MAN-CAMERA` e `NE-MAN-TABLET` per hardware
fisico, non bloccanti per questo checkpoint.

## Database e migrazioni

### Runner

- runner unitario: 10/10 pass;
- runner PostgreSQL reale: 24/24 pass, nessuno skip;
- le 37 migrazioni pubblicate sono byte-identiche alla base;
- migrazione candidata: `20260918_z_m3b_fse_import_practices.sql`;
- fresh: 38/38 applicate, replay tutto skipped, verify/status con zero pending,
  mismatch, file mancanti o out-of-order;
- bootstrap fresh: nessun utente predefinito, primo utente SuperAdmin, cambio
  password/login, Area+Generale, Catalogo e CRUD verificati.

### Upgrade populated 37→38

La base disposable 37 conteneva pratica M3A bozza e registrata, righe,
carico/movimento/lotto, integrazione, audit e import AGEA legacy. Il runner
ufficiale ha applicato soltanto la 38; il replay ha prodotto 38 skip e la
verifica finale è `VERIFY_ONLY` senza anomalie. Le nuove tabelle M3B erano
vuote dopo l'upgrade e nessun campione/backfill è stato creato.

I conteggi e gli hash MD5 semantici ordinati seguenti sono identici prima e
dopo; sulle tabelle estese sono escluse dal confronto solo le nuove colonne
M3B, nulle/default per il legacy.

| Tabella                       | Righe | Hash pre = post                                                         |
| ----------------------------- | ----: | ----------------------------------------------------------------------- |
| `prodotti`                    |     1 | `5f9a762f6d7d09350d896c45049e1d9d`                                      |
| `lotti`                       |     1 | `d2c81e29e67bf6c46cc314fb2613d18a`                                      |
| `movimenti`                   |     1 | `c564282ca0da58333eaf9ed51749183f`                                      |
| `prenotazioni_magazzino`      |     0 | `2a6f2e950fd897f315442448ca02a488`                                      |
| `carichi_magazzino` / righe   | 1 / 1 | `d70db48b20920ec96a73a128ae2fc41b` / `a8fee183af11fda9828eeef261747214` |
| `carico_pratiche` / righe     | 2 / 2 | `8bc0e1d204be75210fec975a874a763a` / `5a303aef6931b471ef333bc982e73231` |
| `carico_integrazioni` / righe | 1 / 1 | `43fbd74dbd5a12a394bf2a912d953687` / `271d9905c129e10b32be0e9aa322409d` |
| `carico_pratica_rettifiche`   |     0 | `2a6f2e950fd897f315442448ca02a488`                                      |
| `audit_eventi`                |     1 | `992f0a31e27bc38106030ade079f2047`                                      |
| `importazioni_agea` / righe   | 1 / 0 | `1396f0ce82a6c03a02b16b66f2ec3ea0` / `2a6f2e950fd897f315442448ca02a488` |
| `mappature_prodotti_esterni`  |     0 | `2a6f2e950fd897f315442448ca02a488`                                      |

La pratica bozza è ancora riprendibile e quella registrata è leggibile dopo
l'upgrade.

## Suite e contratti

Tool: Node `22.23.2`, pnpm `10.34.5`, Git `2.39.5`, Docker `29.5.3`,
Playwright `1.62.1`.

| Gate                                  | Esito finale                                                     |
| ------------------------------------- | ---------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`      | pass; lockfile invariato                                         |
| parser/backend M3B mirati             | parser 11/11; backend 17/17                                      |
| suite API completa                    | 114 file, 1.257 pass, 2 skip, 0 fail                             |
| suite frontend completa               | 69 file, 379 pass, 0 skip/fail                                   |
| run combinato M3B/M3A/AGEA/M1B/M1C/M2 | 6 file, 83 pass, 1 skip, 0 fail                                  |
| typecheck workspace                   | pass                                                             |
| codegen React/Zod                     | due passaggi; checksum file byte-identici                        |
| build workspace                       | pass con `PORT=8080`, `BASE_PATH=/`, Maps pubbliche disabilitate |
| bundle budget                         | pass: entry 1.300,0 KiB, 359,6 KiB gzip                          |
| runtime config web                    | 14/14 pass                                                       |
| Prettier pertinente                   | pass                                                             |
| `git diff --check`                    | pass                                                             |

I due skip della suite API sono i test legacy opzionali legati alla variabile
esterna `AGEA_ACCEPTANCE_XLSX`: “acceptance sul registro AGEA reale” e
“bootstrap del registro reale”. Non coprono né mascherano T01/T25, eseguiti
nei test M3B con entrambi gli originali.

La failure M2 osservata durante lo sviluppo (`PRODOTTO_ATTIVATO` presentato
prima di `PRODOTTO_CREATO` a timestamp equivalente) non si riproduce né nel
run combinato finale né nella suite API completa: viene registrata come
**failure precedente non riprodotta**, non come baseline dimostrata.

## E2E Playwright

- desktop 1440×900: 6 scenari passati, 1 caso tablet saltato per viewport;
- tablet landscape 1024×768: scenario richiesto passato, 4 casi desktop
  saltati intenzionalmente;
- tablet portrait 768×1024: scenario richiesto passato, 4 casi desktop
  saltati intenzionalmente.

I test attraversano UI e API reali, leggono i due originali nel caso saldo e
coprono import ordinario, mapping, prodotto/barcode con e senza permesso,
ripresa/reimport, draft e stale version, M3A 80+20, saldo 1.177 e ritorno alla
pratica. Sui viewport tablet verificano import, eccezione, riepilogo, ritorno,
scroll/overflow e raggiungibilità dei controlli con target touch 44×44.

## Failure incontrate e risolte

1. Il test della migrazione AGEA 2.0B attendeva quattro constraint, ma M3B
   sostituisce correttamente quello globale delle mappature con due indici
   unici parziali. L'assert ora verifica il contratto evoluto; 2/2 pass.
2. Un test AGEA verificava tutte le importazioni confermate del DB condiviso e
   poteva includere fixture M3B concorrenti. Il filtro è stato ristretto ai
   propri dati senza cambiare codice applicativo; 19 pass e 1 skip opzionale.
3. Un locator tablet non raggiungeva un'opzione fuori viewport. L'E2E usa la
   tastiera sul controllo reale; nessun comportamento applicativo è simulato.

Nessun test è stato rimosso, indebolito o trasformato in skip.

## Ambiente e cleanup

Sono state create esclusivamente queste risorse disposable, etichettate M3B:

- container `magazzino-m3b-test-db-20260918`;
- rete `magazzino-m3b-test-net-20260918`;
- volume `magazzino_m3b_test_pgdata_20260918`;
- database interni `magazzino_m3b_test`, `magazzino_m3b_e2e_test` e
  `magazzino_m3b_populated_test`.

Al termine container, rete, volume, report Playwright e fixture temporanei sono
rimossi nominativamente, senza comandi prune. `magazzino-postgres`,
`magazzino-api`, `magazzino-web`, il loro volume persistente e le risorse di
altri progetti restano invariati.

## Gate G1–G8

| Gate                                                    | Esito |
| ------------------------------------------------------- | ----- |
| G1 — branch/base/perimetro Git                          | GO    |
| G2 — review e seconda review                            | GO    |
| G3 — originali, T01/T25, sette partite                  | GO    |
| G4 — T01–T35, claim/saldo/legacy/rollback               | GO    |
| G5 — suite complete ed E2E                              | GO    |
| G6 — fresh/populated/runner/integrità                   | GO    |
| G7 — typecheck/codegen/build/budget/runtime/format/diff | GO    |
| G8 — documentazione/cleanup/ambienti protetti           | GO    |

Decisione: **GO al commit e al push del solo branch
`codex/magazzino-workflow-unificato`**. Nessun merge su `main`; nessun avvio di
M4/M5.
