# Magazzino 2.0C — riconciliazione AGEA/SIFEAD

## Obiettivo e immutabilità

La riconciliazione confronta uno snapshot del ledger locale con una
importazione AGEA confermata dello stesso Magazzino. È un controllo
amministrativo non mutante: non crea Movimenti, non rettifica Partite, non
modifica staging/raw AGEA e non applica negativi esterni. Le correzioni passano
sempre dai normali flussi contabili append-only.

Input: Magazzino, importazione corrente, baseline cumulativa precedente
opzionale, data di riferimento e cutoff locale. Le testate conservano versione
modello, cutoff, hash, conteggi, stato, utente e date. Le righe congelano valori
locali/esterni, differenze Pezzi/Kg/Lt, metodo di matching, qualità e content
hash. Le risoluzioni manuali hanno audit old/new, azione, motivazione, attore e
timestamp.

## Saldo teorico e delta cumulativo

Il saldo locale as-of deriva esclusivamente dai Movimenti fino a data e cutoff,
con Fondo snapshot e segno della natura contabile. Il saldo esterno deriva dal
registro confermato. Quando esiste una baseline precedente, nuovi record e
modifiche si determinano mediante identity hash, content hash e occorrenza nel
multinsieme; il numero riga non è un'identità business. Pezzi e Kg/Lt non sono
mai sommati fra loro.

La prima importazione confermata può essere assorbita come baseline: i carichi
storici già materializzati da AGEA sono `BASELINE_ASSORBITA` e non falsi
`SOLO_AGEA`. Dalla seconda importazione il confronto usa il delta cumulativo
reale rispetto alla precedente. Le Partite con saldo esterno positivo
producono inoltre righe `SALDO_PARTITA`, confrontate con il saldo locale as-of
per Magazzino, Fondo, prodotto e lotto.

## Matching deterministico

Ordine dei livelli:

1. lineage diretto verso la riga di carico;
2. exact deterministic su natura, Fondo, prodotto, lotto, data, Pezzi, Kg/Lt e
   canale normalizzato;
3. pairing deterministico del multinsieme per occorrenza;
4. candidato univoco solo per esporre uno scostamento strutturato;
5. ambiguità bloccante o record solo locale/solo AGEA.

Non viene usato fuzzy matching, AI o auto-match probabilistico. Le differenze
sono codificate: Fondo/prodotto/lotto/data/canale/quantità/statistiche,
`MOVIMENTO_AGEA_MODIFICATO`, `PRODOTTO_NON_MAPPATO`, storno/reso/rettifica non
riscontrati e `RICONCILIAZIONE_AMBIGUA`.

## Stati e workflow

Testata: `CALCOLATA`, `DA_RIVEDERE`, `RICONCILIATA`,
`CHIUSA_CON_SCOSTAMENTI`, `ANNULLATA`. Riga: riconciliata esatta oppure stato
esplicito di scostamento/assenza/ambiguità.

Il ricalcolo è consentito solo su snapshot aperti e produce nuovamente righe e
hash a cutoff coerente. Una risoluzione manuale (`ABBINA`, `DISABBINA`,
`ACCETTA_SCOSTAMENTO`, `SEGNALA_DA_CORREGGERE`, `RIAPRI`) richiede permesso di
gestione, versione corrente e motivazione. La chiusura senza scostamenti è
permessa solo con zero bloccanti e zero scostamenti; la chiusura con
scostamenti richiede accettazione e motivazione esplicite. Uno snapshot chiuso
non viene riscritto.

`ACCETTA_SCOSTAMENTO` conserva `exact=false` e lo stato
`SCOSTAMENTO_ACCETTATO`: non equivale a una riconciliazione esatta. `ABBINA`
richiede ID reali di Movimento e riga import, li verifica nello stesso
snapshot/Magazzino e ricalcola valori, differenze e hash. `DISABBINA` separa
le due componenti locale/esterna. Ogni risoluzione registra target, versione
testata prima/dopo e stato calcolato prima/dopo.

## API, scope e concorrenza

Gli endpoint `/api/fse/riconciliazioni` espongono lista, creazione, dettaglio,
righe paginate, ricalcolo, risoluzione, chiusura e annullamento. Una
riconciliazione appartiene a un solo Magazzino e ogni accesso è ricontrollato
server-side mediante Area Operativa/Centro/Magazzino; gli ID client non
ampliano lo scope.

Permessi: `magazzino.fse.reconcile` per calcolo/ricalcolo e
`magazzino.fse.reconcile.manage` per risoluzioni e chiusura. Advisory lock,
vincoli univoci, lock di riga e optimistic version impediscono duplicazioni e
chiusure concorrenti. Versione assente/malformata produce 400; versione stale
produce 409.

La richiesta è identificata da hash canonico e idempotency key. Un replay con
stesso import, baseline, data e cutoff restituisce la riconciliazione esistente;
payload divergenti o calcoli concorrenti non possono creare duplicati.

## Privacy e verifiche

Il confronto usa riferimenti contabili e codici operativi, non nomi, contatti,
codici fiscali, indirizzi o note sociali. I test coprono link diretto, exact,
multinsieme, ambiguità, mismatch, record locali/esterni, resi, rettifiche,
storni, ricalcolo, stale version, chiusura e assenza di mutazioni sulle fonti.

## Lifecycle righe R2

Le righe espongono `active`, `resolutionGroupId`, `companionRowId` e
`supersededByRowId`. Indici parziali consentono al massimo una riga attiva per
Movimento e una per riga AGEA. `ABBINA` consuma le sorgenti e lascia una coppia
attiva; `DISABBINA` lascia due companion; `RIAPRI` disattiva i companion e
ripristina atomicamente la coppia calcolata. Audit e conteggi considerano solo
righe attive.

Il delta segnala `MOVIMENTO_AGEA_SCOMPARSO`. I Movimenti locali registrati dopo
la baseline sono selezionati tramite il precedente cutoff ID, anche se hanno
data evento retrodatata.
