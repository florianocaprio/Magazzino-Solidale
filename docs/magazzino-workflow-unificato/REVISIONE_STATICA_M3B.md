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

## Review indipendente post-pubblicazione — H1/H2/H3/H4

Questa sezione registra una review successiva e indipendente rispetto
all'esito storico sopra riportato. La frase «Nessun finding bloccante resta
aperto» descriveva la revisione del candidato originario; la review
post-pubblicazione ha poi individuato quattro controesempi ulteriori. La base
revisionata resta `32a6953d4b2d07a4db2f747f4febdeb1e5230f0f`; il preflight
del correttivo è partito dalla successiva HEAD pubblicata
`fcd445576bae9c10e9c155b29659009de5fdf5a1`, senza riscriverla.

| Finding               | Controesempio e causa                                                                                                                                                                                                            | Correzione verificata                                                                                                                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1 — identità esterna | Dopo una correzione `LOT-A→LOT-B`, documento o data, la riga sostituiva l'identità originale con quella operativa. Un export successivo della stessa sorgente poteva quindi ripresentare la forma originale come nuovo ingresso. | L'identità raw resta immutabile; le identità accettate sono revisionate e collegate all'evento canonico tramite alias verificati. Claim, forma originale e forma corretta convergono solo con provenienza dimostrabile; alias ambigui diventano `DA_VERIFICARE`.                                    |
| H2 — pratica stale    | `addFseRowsToPractice` leggeva la pratica prima del `FOR UPDATE` e continuava a validare versione/stato sulla snapshot precedente anche dopo aver atteso un'altra transazione.                                                   | Lock e rilettura autorevole precedono ogni controllo di versione, stato, tipo e contesto. L'update finale è condizionale sulla versione e deve restituire la riga aggiornata; in caso contrario produce `409`.                                                                                      |
| H3 — import parziale  | Una singola riga `DA_ASSOCIARE`, `ERRORE` o `DA_VERIFICARE` impediva l'aggiunta delle altre righe `PRONTO`, perché API e UI dipendevano dallo stato globale della sessione.                                                      | In `NUOVI_CARICHI` il backend valida atomicamente soltanto il sottoinsieme esplicitamente selezionato; le escluse restano nello staging riprendibile senza claim. La UI conserva la selezione dopo refetch e non seleziona automaticamente righe appena corrette. `SALDO_INIZIALE` resta integrale. |
| H4 — retry browser    | Dopo un commit backend con risposta persa, il retry creava una nuova idempotency key e aggiornava implicitamente le versioni del payload, impedendo il replay deterministico.                                                    | Un'intenzione canonica conserva key e payload esatto fino a esito determinato. Errori di rete/parsing mantengono l'intenzione; successo o errore HTTP definitivo la chiudono. Nuova selezione, pratica, modalità o copertura generano una nuova key.                                                |

### Persistenza e migrazione 39

La soluzione H1 aggiunge esclusivamente
`20260918_za_m3b_fse_identity_aliases.sql`, successiva alle 38 migrazioni già
pubblicate e lasciate byte-identiche. `fse_movement_identity_aliases` conserva
sorgente, identità candidata, disambiguatore, evento canonico e revisione di
origine, con unicità DB e vincoli sugli hash. Il servizio idrata in modo
conservativo gli alias delle claim preesistenti solo quando la provenienza è
dimostrabile; non esegue merge o backfill ciechi e non modifica stock,
movimenti, carichi, audit o revisioni storiche.

L'upgrade populated 38→39 ha applicato soltanto la nuova migrazione. Prima e
dopo sono rimasti identici i campioni semantici di ledger, movimenti, dato
legacy e audit:

- ledger: `1 | 7,000000 | 9ea20d09bed1e581303b2ceb665976c4`;
- movimenti: `1 | 7,000000 | 7ab80ee325f77dd51dfee8f08c71f370`;
- legacy: `1 | 2a0fb4e236674cad3d8425875d0db1a7`;
- audit: `1 | a2278b9450f49da28b4cbfea493271f1`.

Fresh, replay, ordine e checksum hanno chiuso a 39/39. Nessun contratto
OpenAPI o file generato è cambiato, quindi il codegen non era pertinente al
delta.

### Seconda review del correttivo

La rilettura finale conferma:

- nessuna identity accettata sovrascrive più l'identità esterna originale;
- alias e claim sono serializzati per sorgente e protetti da unicità DB;
- nessuna validazione usa la pratica letta prima del lock;
- l'import ordinario parziale non estende la semantica al saldo iniziale;
- upload, analisi e associazione restano senza effetti inventariali;
- il retry frontend non riusa una key con payload differente e non nasconde i
  `409` definitivi;
- scope, RBAC, attore backend, audit transazionale, fixed-point e writer AGEA
  restano invariati;
- non sono stati modificati OpenAPI, client generati o le prime 38 migrazioni.

Il candidato corretto resta **automaticamente GO per una nuova code review**,
non per validazione umana o Docker candidato. Restano
`NE-MAN-CAMERA` e `NE-MAN-TABLET`.
