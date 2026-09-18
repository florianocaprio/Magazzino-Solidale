# M3B — Revisione statica finale

Data: 18 settembre 2026

Branch: `codex/magazzino-workflow-unificato`

Base revisionata: `ad76175a360794ceeb36a7024b1933ba5e6b2bba`

## Perimetro

La revisione copre parser FSE+/AGEA, persistenza delle sessioni, claim e
copertura storica, integrazione con le pratiche M3A, migrazione 38, OpenAPI e
client generati, UI del wizard, test automatici e compatibilità con il writer
AGEA legacy. Le 37 migrazioni già pubblicate sono rimaste byte-identiche alla
base; il solo nuovo file è
`20260918_z_m3b_fse_import_practices.sql`.

## Esito

**Nessun finding bloccante resta aperto.** La seconda revisione del diff finale
non rileva bypass di scope, scritture inventariali alternative, indebolimenti
degli assert o skip aggiunti per ottenere il verde.

## Finding corretti durante la review

| Area                   | Problema rilevato                                                                            | Correzione verificata                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claim                  | Il controllo legacy poteva essere eluso scegliendo un altro magazzino                        | La sorgente e l'identità esterna governano la collisione; i casi cross-magazzino restano `DA_VERIFICARE` e il writer legacy è bloccato quando M3B ha adottato il magazzino |
| RBAC                   | La creazione di una sorgente non era riservata in modo uniforme                              | Endpoint e UI richiedono amministratore; la creazione prodotto/barcode continua a richiedere `magazzino.products.manage`                                                   |
| Immutabilità           | Mapping e righe già associate o registrate potevano essere mutate                            | Le righe claimed/registrate e le registrazioni storiche sono immutabili; il mapping nuovo vale soltanto per elaborazioni successive                                        |
| Ripresa                | Una sessione parziale non incrementava coerentemente la versione                             | Ogni modifica osservabile aggiorna la versione e i comandi stale restituiscono conflitto                                                                                   |
| Copertura              | Il saldo poteva procedere senza conferma esplicita della copertura storica                   | La copertura è un requisito persistito e verificato prima dell'associazione/registrazione                                                                                  |
| Concorrenza saldo      | Due inizializzazioni o un altro writer inventariale potevano correre sullo stesso magazzino  | Lock di ambito, vincolo di copertura e trigger DB serializzano saldo e writer ordinari                                                                                     |
| Annullamento           | Annullare una pratica non contabilizzata poteva lasciare claim pendenti                      | Annullamento e rilascio claim sono transazionali e auditati; eventi registrati/coperti non vengono liberati                                                                |
| Date                   | I seriali Excel con epoch 1904 non erano distinti dai seriali 1900                           | Il parser usa il flag workbook e i test coprono entrambi gli epoch, date ambigue e invalide                                                                                |
| Saldo                  | Le 239 righe del Registro rischiavano di essere trattate come carichi del saldo              | Solo le 7 righe Giacenze sono operative; il Registro alimenta riconciliazione e copertura, senza creare 24.216 pezzi                                                       |
| Tipologia prodotto     | La creazione da wizard usava un tipo non coerente con il catalogo                            | Il tipo è `alimentare`, con unità e frazionabilità validate dagli helper M2                                                                                                |
| Errori DB              | Un errore PostgreSQL annidato poteva diventare 500                                           | I conflitti attesi sono tradotti in 409 senza esporre dettagli riservati                                                                                                   |
| Riconciliazione        | Il ricalcolo poteva sovrascrivere `DATO_MODIFICATO` o perdere il caso legacy cross-magazzino | Gli stati prudenziali vengono preservati; non diventano automaticamente righe nuove                                                                                        |
| Compatibilità AGEA     | La route legacy poteva perdere il codice di errore M3B                                       | Il codice applicativo viene tradotto nell'errore AGEA equivalente mantenendo status e semantica                                                                            |
| Versione saldo UI      | L'associazione saldo non inviava sempre la versione ottimistica della pratica                | Il wizard invia sempre `versionePratica` e gestisce 409/stale state                                                                                                        |
| Navigazione            | Il riepilogo saldo non consentiva il ritorno allo step precedente                            | `Indietro` è disponibile per ogni step successivo al primo senza perdere il draft                                                                                          |
| Accessibilità          | Close dialog e checkbox esponevano target touch 16×16                                        | Il target interattivo è 44×44, mantenendo il segno grafico compatto                                                                                                        |
| Test migrazione legacy | Il test 2.0B attendeva il vincolo globale rimosso intenzionalmente da M3B                    | L'asserzione verifica i tre vincoli storici rimasti e i due indici unici parziali legacy/per-sorgente                                                                      |
| Isolamento test AGEA   | Un assert leggeva tutte le importazioni confermate del DB condiviso                          | L'assert è ristretto alle righe create dal test; non cambia la semantica applicativa né l'ordine audit                                                                     |

## Invarianti confermati

- Esiste un solo motore inventariale: upload e associazione producono staging e
  righe pratica; soltanto `Registra` M3A crea carichi, lotti, movimenti e audit.
- Identità semantica, hash file, claim e idempotency key hanno ruoli distinti.
  Quantità o mapping modificati non trasformano un evento esterno già noto in
  un nuovo ingresso automatico.
- La pratica ordinaria può essere ripresa e completata a tranche; la pratica
  `SALDO_INIZIALE` è invece integrale e attiva stock e copertura nella stessa
  transazione.
- L'attore deriva dalla sessione backend. Audit failure, conflitto di versione
  o violazione della copertura effettuano rollback dell'intero comando.
- Area, magazzino e sorgente sono verificati lato backend. Gli errori di scope
  non espongono il contenuto del file o identità riservate.
- I raw persistiti sono dati, non file eseguibili. Limiti, firme reali,
  contenuto attivo, ZIP anomali, fogli ambigui, estensioni false e input corrotti
  sono respinti con errore controllato. `CodiceAccesso` non viene restituito né
  riportato nei log/audit.
- Il saldo reale conserva Fondo/Prodotto/Lotto, pezzi, peso/volume e scadenza;
  non inventa lotto produttore e non somma indiscriminatamente kg e litri.

## Rischi residui non bloccanti

- `NE-MAN-CAMERA`: nessuna prova con fotocamera fisica; permesso negato e
  scanner indisponibile sono coperti automaticamente senza perdita del draft.
- `NE-MAN-TABLET`: i viewport 1024×768 e 768×1024 sono coperti in Playwright,
  ma non equivalgono a un dispositivo fisico.
- I due skip API rimasti riguardano esclusivamente la fixture esterna opzionale
  `AGEA_ACCEPTANCE_XLSX` del percorso legacy. T01 e T25 M3B usano invece i due
  originali richiesti e non sono saltati.
- Restano warning non bloccanti già noti: deprecazione `pg` sulle query
  concorrenti, sourcemap Vite e chunk principale oltre 500 kB ma entro il
  budget verificato.

## Decisione di review

Il candidato è **GO** per commit e pubblicazione condizionata al completamento
dei gate documentali, di pulizia Docker e di verifica Git/remota descritti in
`ESITI_TEST_M3B.md`.
