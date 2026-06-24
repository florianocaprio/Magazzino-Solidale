# PROMPT COMPLETO — MAGAZZINO SOLIDALE AIM
## Applicazione web Python/Flask per la gestione di un magazzino solidale

---

## NOTA OPERATIVA PER IL GENERATORE DI CODICE

Questo prompt è lungo e articolato. Se non riesci a generare tutto in una sola risposta,
procedi **modulo per modulo** nell'ordine seguente, producendo codice funzionante a ogni passo:

1. Struttura progetto + `config.py` + `models.py` + `database.py` + `seed_data.py`
2. Magazzino + Prodotti + Lotti + Movimenti carico/scarico + Giacenze
3. Fornitori + Approvvigionamenti + Trasferimenti
4. Beneficiari + Nucleo familiare + Interventi sociali
5. Consegne + Bolle + Logistica + Mezzi + Volontari
6. Report + Esportazioni CSV/PDF
7. Modulo predittivo + Dashboard + API JSON interne
8. Autenticazione + Ruoli + Log operazioni

Ogni blocco deve essere **compilabile e avviabile** prima di passare al successivo.
Non tralasciare nessuna parte. Completa ogni file prima di iniziare il successivo.

---

## STACK TECNOLOGICO — VINCOLI PRECISI

```
Python          3.11
Flask           3.0.x
Flask-SQLAlchemy 3.1.x
Flask-Login     0.6.x
Flask-Migrate   4.0.x       (Alembic per le migrazioni)
Flask-WTF       1.2.x       (form con CSRF)
Werkzeug        3.0.x       (hashing password con pbkdf2)
SQLite          (database iniziale, file solidarity_warehouse.db)
Jinja2          3.1.x       (incluso in Flask)
Bootstrap       5.3         (via CDN, nessun npm)
FullCalendar    6.1         (via CDN, per il calendario consegne)
Pandas          2.2.x       (report e CSV)
FPDF2           2.7.x       (generazione PDF)
Gunicorn        21.x        (server produzione su Replit)
```

**NON usare Scikit-learn nel MVP.** Il modulo predittivo usa solo Python puro
(medie mobili, regole euristiche, calcoli statistici semplici).

**NON usare npm, webpack o framework JS.** Solo Bootstrap + FullCalendar via CDN.

---

## FILE `requirements.txt`

```
Flask==3.0.3
Flask-SQLAlchemy==3.1.1
Flask-Login==0.6.3
Flask-Migrate==4.0.7
Flask-WTF==1.2.1
Werkzeug==3.0.3
pandas==2.2.2
fpdf2==2.7.9
gunicorn==21.2.0
python-dotenv==1.0.1
email-validator==2.1.1
python-barcode==0.15.1     # generazione barcode interno per prodotti privi di EAN
Pillow==10.3.0             # rendering barcode come immagine PNG
qrcode==7.4.2              # QR code opzionale per bolle e trasferimenti
```

---

## FILE `.replit`

```toml
[nix]
channel = "stable-23_11"

[deployment]
run = ["gunicorn", "--bind", "0.0.0.0:5000", "app:app"]

[[ports]]
localPort = 5000
externalPort = 80
```

---

## STRUTTURA DIRECTORY DEL PROGETTO

```
magazzino_solidale/
│
├── app.py                      # Entry point Flask, registrazione blueprint
├── config.py                   # Configurazioni ambiente
├── models.py                   # Tutti i modelli SQLAlchemy
├── database.py                 # Inizializzazione db, funzioni helper
├── seed_data.py                # Dati demo (eseguire separatamente)
├── requirements.txt
├── .env.example
├── .replit
│
├── modules/                    # Blueprint Flask
│   ├── __init__.py
│   ├── auth.py                 # Login, logout, gestione utenti
│   ├── dashboard.py            # Dashboard principale
│   ├── magazzini.py            # CRUD magazzini
│   ├── prodotti.py             # CRUD prodotti
│   ├── lotti.py                # Gestione lotti e scadenze
│   ├── movimenti.py            # Carico e scarico merce
│   ├── trasferimenti.py        # Trasferimenti tra magazzini
│   ├── giacenze.py             # Visualizzazione giacenze
│   ├── fornitori.py            # CRUD fornitori/donatori
│   ├── approvvigionamenti.py   # Pianificazione approvvigionamenti
│   ├── beneficiari.py          # CRM sociale beneficiari
│   ├── nucleo_familiare.py     # Componenti nucleo familiare
│   ├── interventi.py           # Storico interventi sociali
│   ├── consegne.py             # Pianificazione consegne (wizard guidato)
│   ├── bolle.py                # Bolle di consegna e documenti logistici
│   ├── mezzi.py                # Gestione veicoli
│   ├── volontari.py            # Gestione volontari/operatori
│   ├── barcode_manager.py      # Generazione/gestione barcode interni
│   ├── documenti.py            # Generazione PDF di tutti i doc. logistici
│   ├── report.py               # Generazione report CSV/PDF
│   ├── predizione.py           # Modulo predittivo
│   └── api.py                  # Endpoint JSON interni (/api/)
│
├── templates/
│   ├── base.html               # Layout principale con navbar
│   ├── auth/
│   │   ├── login.html
│   │   └── profilo.html
│   ├── dashboard/
│   │   └── index.html
│   ├── magazzini/
│   │   ├── lista.html
│   │   ├── form.html
│   │   └── dettaglio.html
│   ├── prodotti/
│   │   ├── lista.html
│   │   ├── form.html
│   │   └── dettaglio.html
│   ├── lotti/
│   │   ├── lista.html
│   │   └── form.html
│   ├── movimenti/
│   │   ├── carico.html         # Form guidato carico con selezione FEFO
│   │   ├── scarico.html        # Form guidato scarico con selezione FEFO
│   │   └── lista.html
│   ├── trasferimenti/
│   │   ├── lista.html
│   │   ├── form.html
│   │   ├── dettaglio.html
│   │   └── stampa.html         # Documento interno trasferimento (PDF/stampa)
│   ├── giacenze/
│   │   └── index.html
│   ├── fornitori/
│   │   ├── lista.html
│   │   ├── form.html
│   │   └── dettaglio.html
│   ├── approvvigionamenti/
│   │   ├── lista.html
│   │   └── form.html
│   ├── beneficiari/
│   │   ├── lista.html
│   │   ├── scheda.html
│   │   ├── form.html
│   │   └── storico.html
│   ├── nucleo/
│   │   └── form.html
│   ├── interventi/
│   │   ├── lista.html
│   │   └── form.html
│   ├── consegne/
│   │   ├── lista.html
│   │   ├── form.html           # Wizard guidato in 3 step
│   │   ├── calendario.html
│   │   └── dettaglio.html
│   ├── bolle/
│   │   ├── lista.html
│   │   ├── dettaglio.html
│   │   └── stampa.html         # Layout ottimizzato stampa/PDF con spazio firma
│   ├── barcode/
│   │   ├── genera.html         # Generazione barcode interno per prodotto
│   │   ├── lista.html          # Archivio barcode interni generati
│   │   └── etichette.html      # Stampa etichette multipla (A4 con griglie)
│   ├── mezzi/
│   │   ├── lista.html
│   │   └── form.html
│   ├── volontari/
│   │   ├── lista.html
│   │   ├── form.html
│   │   └── dettaglio.html
│   ├── report/
│   │   └── index.html
│   └── predizione/
│       └── index.html
│
├── static/
│   ├── css/
│   │   └── custom.css
│   ├── js/
│   │   └── main.js
│   └── img/
│       └── logo.png
│
├── exports/
│   ├── pdf/
│   └── csv/
│
└── uploads/
    └── barcode/                # Immagini PNG dei barcode interni generati
```

---

## SCHEMA DEL DATABASE — DETTAGLIO COMPLETO

Di seguito sono descritte tutte le tabelle con i campi, i tipi, i vincoli e le relazioni.
Implementa ogni tabella come classe SQLAlchemy in `models.py`.

---

### TABELLA: `utenti`

Gestione accessi e ruoli.

```
id              INTEGER     PRIMARY KEY AUTOINCREMENT
username        VARCHAR(80) NOT NULL UNIQUE
email           VARCHAR(120) NOT NULL UNIQUE
password_hash   VARCHAR(256) NOT NULL
nome            VARCHAR(80)
cognome         VARCHAR(80)
ruolo           VARCHAR(30) NOT NULL
                -- valori: 'amministratore', 'coordinatore',
                --         'operatore_sociale', 'magazziniere',
                --         'volontario_consegne', 'sola_lettura'
attivo          BOOLEAN     DEFAULT TRUE
data_creazione  DATETIME    DEFAULT NOW
ultimo_accesso  DATETIME
note            TEXT
```

---

### TABELLA: `log_operazioni`

Audit trail delle operazioni principali.

```
id              INTEGER     PRIMARY KEY AUTOINCREMENT
utente_id       INTEGER     FK → utenti.id
data_ora        DATETIME    DEFAULT NOW
azione          VARCHAR(50) -- 'creazione', 'modifica', 'cancellazione', 'login', ecc.
modello         VARCHAR(50) -- nome della tabella coinvolta
record_id       INTEGER     -- id del record coinvolto
descrizione     TEXT
ip_address      VARCHAR(45)
```

---

### TABELLA: `magazzini`

```
id              INTEGER     PRIMARY KEY AUTOINCREMENT
codice          VARCHAR(20) NOT NULL UNIQUE
nome            VARCHAR(120) NOT NULL
indirizzo       VARCHAR(200)
comune          VARCHAR(80)
zona            VARCHAR(80)
responsabile    VARCHAR(120)
telefono        VARCHAR(20)
email           VARCHAR(120)
stato           VARCHAR(20) DEFAULT 'attivo'
                -- valori: 'attivo', 'non_attivo', 'temporaneo'
note            TEXT
data_creazione  DATETIME    DEFAULT NOW
creato_da       INTEGER     FK → utenti.id
```

---

### TABELLA: `categorie_prodotto`

```
id              INTEGER     PRIMARY KEY AUTOINCREMENT
nome            VARCHAR(80) NOT NULL
tipo_principale VARCHAR(30) NOT NULL
                -- valori: 'alimentare', 'igiene', 'vestiario',
                --         'scarpe', 'sanitario', 'altro'
descrizione     TEXT
```

---

### TABELLA: `prodotti`

```
id                  INTEGER     PRIMARY KEY AUTOINCREMENT
codice              VARCHAR(30) NOT NULL UNIQUE
nome                VARCHAR(150) NOT NULL
descrizione         TEXT
categoria_id        INTEGER     FK → categorie_prodotto.id
tipo_prodotto       VARCHAR(20) NOT NULL
                    -- valori: 'alimentare', 'igiene', 'vestiario',
                    --         'scarpe', 'sanitario', 'altro'
unita_misura        VARCHAR(20) NOT NULL
                    -- valori: 'pezzo', 'confezione', 'pacco',
                    --         'kg', 'grammi', 'litri', 'ml', 'paio', 'taglia'
codice_barre        VARCHAR(50)
gestione_lotto      BOOLEAN     DEFAULT FALSE
gestione_scadenza   BOOLEAN     DEFAULT FALSE
scorta_minima       DECIMAL(10,2) DEFAULT 0
scorta_consigliata  DECIMAL(10,2) DEFAULT 0
fornitore_id        INTEGER     FK → fornitori.id  (nullable)
peso_lordo          DECIMAL(10,3)
peso_netto          DECIMAL(10,3)
volume              DECIMAL(10,3)
-- Campi specifici per alimentari
conservazione       VARCHAR(20)
                    -- valori: 'secco', 'fresco', 'surgelato', 'refrigerato', 'altro'
allergeni           TEXT
note_alimentari     TEXT
-- Campi specifici per vestiario/scarpe
taglia              VARCHAR(20)
genere              VARCHAR(20)
                    -- valori: 'uomo', 'donna', 'bambino', 'unisex'
stagione            VARCHAR(20)
                    -- valori: 'estate', 'inverno', 'mezza_stagione', 'tutte'
condizione          VARCHAR(30)
                    -- valori: 'nuovo', 'usato_buono', 'usato_da_verificare'
colore              VARCHAR(50)
-- Barcode
codice_barre_interno VARCHAR(30)     -- barcode AIM generato internamente (nullable)
ha_barcode_commerciale BOOLEAN DEFAULT FALSE
-- Metadati
attivo              BOOLEAN     DEFAULT TRUE
note                TEXT
data_creazione      DATETIME    DEFAULT NOW
creato_da           INTEGER     FK → utenti.id
```

---

### TABELLA: `barcode_interni`

Archivio dei barcode generati internamente dal sistema per prodotti
privi di codice commerciale EAN/UPC.

```
id                  INTEGER     PRIMARY KEY AUTOINCREMENT
prodotto_id         INTEGER     FK → prodotti.id NOT NULL UNIQUE
codice_aim          VARCHAR(30) NOT NULL UNIQUE
                    -- Formato: AIM-XXXXXXXX (es. AIM-00010042)
                    -- Generato automaticamente dal sistema con prefisso AIM
tipo_barcode        VARCHAR(20) DEFAULT 'code128'
                    -- valori: 'code128', 'ean13', 'qr'
                    -- Usare 'code128' come default (massima compatibilità)
path_immagine       VARCHAR(200)
                    -- Path relativo al file PNG in uploads/barcode/
data_generazione    DATETIME    DEFAULT NOW
generato_da         INTEGER     FK → utenti.id
note                TEXT
```

**Logica di generazione barcode (`modules/barcode_manager.py`):**

```python
import barcode
from barcode.writer import ImageWriter
import os

def genera_barcode_interno(prodotto_id):
    """
    Genera un barcode Code128 per il prodotto indicato.
    Assegna un codice univoco formato AIM-{prodotto_id:08d}.
    Salva l'immagine PNG in uploads/barcode/AIM-{codice}.png
    Crea il record in barcode_interni.
    Restituisce il codice generato.
    """
    codice = f"AIM-{prodotto_id:08d}"
    cls = barcode.get_barcode_class('code128')
    bc = cls(codice, writer=ImageWriter())
    path = os.path.join('uploads', 'barcode', f'AIM-{prodotto_id:08d}')
    bc.save(path)
    return codice

def genera_etichetta_pdf(prodotto_ids, formato='A4', colonne=3):
    """
    Genera un PDF con griglia di etichette per la stampa.
    Ogni etichetta contiene: nome prodotto, codice, barcode.
    Parametri: formato foglio A4 o A5, numero colonne (2 o 3).
    Salva in exports/pdf/etichette_{timestamp}.pdf
    """

def get_barcode_img_url(prodotto_id):
    """
    Restituisce l'URL relativo dell'immagine barcode del prodotto,
    sia essa commerciale (mostra placeholder) o interna.
    """
```

---

### TABELLA: `fornitori`

```
id              INTEGER     PRIMARY KEY AUTOINCREMENT
nome            VARCHAR(150) NOT NULL
tipo            VARCHAR(30) NOT NULL
                -- valori: 'commerciale', 'donatore_privato', 'azienda',
                --         'fondazione', 'banco_alimentare', 'ente_pubblico',
                --         'parrocchia', 'associazione', 'altro'
partita_iva     VARCHAR(20)
codice_fiscale  VARCHAR(20)
indirizzo       VARCHAR(200)
comune          VARCHAR(80)
telefono        VARCHAR(20)
email           VARCHAR(120)
referente       VARCHAR(120)
sito_web        VARCHAR(200)
prodotti_tipici TEXT
attivo          BOOLEAN     DEFAULT TRUE
note            TEXT
data_creazione  DATETIME    DEFAULT NOW
creato_da       INTEGER     FK → utenti.id
```

---

### TABELLA: `lotti`

Ogni riga rappresenta un lotto fisico di un prodotto in un magazzino.

```
id                      INTEGER     PRIMARY KEY AUTOINCREMENT
prodotto_id             INTEGER     FK → prodotti.id NOT NULL
codice_lotto            VARCHAR(80)
codice_barre_lotto      VARCHAR(80)
data_scadenza           DATE        (nullable se prodotto senza scadenza)
data_carico             DATE        NOT NULL
quantita_caricata       DECIMAL(10,2) NOT NULL
quantita_residua        DECIMAL(10,2) NOT NULL
magazzino_id            INTEGER     FK → magazzini.id NOT NULL
fornitore_id            INTEGER     FK → fornitori.id (nullable)
documento_carico        VARCHAR(100)
movimento_id            INTEGER     FK → movimenti.id (nullable, popolato dopo)
note                    TEXT
data_creazione          DATETIME    DEFAULT NOW
creato_da               INTEGER     FK → utenti.id
```

**Indici consigliati:**
- `(prodotto_id, magazzino_id)` — per le query di giacenza
- `(data_scadenza)` — per gli alert scadenze
- `(prodotto_id, data_scadenza)` — per logica FEFO

---

### TABELLA: `movimenti`

Registro unico di tutti i movimenti di magazzino (carico e scarico).

```
id                  INTEGER     PRIMARY KEY AUTOINCREMENT
tipo_movimento      VARCHAR(20) NOT NULL
                    -- valori: 'carico', 'scarico'
tipo_dettaglio      VARCHAR(40) NOT NULL
                    -- per carico: 'acquisto', 'donazione', 'banco_alimentare',
                    --   'raccolta_alimentare', 'trasferimento_entrata',
                    --   'rettifica_positiva', 'altro'
                    -- per scarico: 'consegna_beneficiario', 'consegna_domicilio',
                    --   'consegna_associazione_partner', 'distribuzione_sede',
                    --   'scaduto', 'danneggiato', 'non_distribuibile',
                    --   'trasferimento_uscita', 'rettifica_negativa', 'altro'
                    -- NOTA: ogni tipo_dettaglio genera automaticamente
                    --       un documento logistico associato (vedi modulo documenti.py)
documento_id        INTEGER     FK → documenti_logistici.id (nullable)
                    -- documento PDF generato associato al movimento
data_movimento      DATE        NOT NULL
magazzino_id        INTEGER     FK → magazzini.id NOT NULL
prodotto_id         INTEGER     FK → prodotti.id NOT NULL
lotto_id            INTEGER     FK → lotti.id (nullable)
quantita            DECIMAL(10,2) NOT NULL
unita_misura        VARCHAR(20) NOT NULL
fornitore_id        INTEGER     FK → fornitori.id (nullable)
beneficiario_id     INTEGER     FK → beneficiari.id (nullable)
bolla_id            INTEGER     FK → bolle.id (nullable)
trasferimento_id    INTEGER     FK → trasferimenti.id (nullable)
documento_riferimento VARCHAR(100)
operatore_id        INTEGER     FK → utenti.id
note                TEXT
data_creazione      DATETIME    DEFAULT NOW
```

**Vincolo logico da implementare nel codice:**
Prima di ogni scarico verificare che `lotto.quantita_residua >= quantita`.
In caso contrario restituire un errore comprensibile all'utente.

---

### TABELLA: `documenti_logistici`

Registro centralizzato di tutti i documenti generati dal sistema
(bolle di consegna, documenti di trasferimento, documenti di carico/scarico).
Ogni documento ha un PDF associato e un ciclo di vita con stato.

```
id                  INTEGER     PRIMARY KEY AUTOINCREMENT
tipo_documento      VARCHAR(30) NOT NULL
                    -- valori:
                    -- 'bolla_consegna'           → uscita verso beneficiario
                    -- 'bolla_partner'            → uscita verso associazione partner
                    -- 'documento_trasferimento'  → trasferimento tra magazzini
                    -- 'documento_carico'         → entrata merce (acquisto/donazione/raccolta)
                    -- 'documento_scarico_scaduto'   → scarico per prodotto scaduto
                    -- 'documento_scarico_danneggiato' → scarico per merce non distribuibile
numero_documento    VARCHAR(30) NOT NULL UNIQUE
                    -- Formato per tipo:
                    -- bolle:           BOLLA-YYYY-NNNN
                    -- trasferimenti:   TRASM-YYYY-NNNN
                    -- carichi:         CAR-YYYY-NNNN
                    -- scarichi spec.:  SCR-YYYY-NNNN
data_documento      DATETIME    NOT NULL
magazzino_origine_id  INTEGER   FK → magazzini.id (nullable)
magazzino_destino_id  INTEGER   FK → magazzini.id (nullable)
beneficiario_id     INTEGER     FK → beneficiari.id (nullable)
partner_nome        VARCHAR(150)  -- nome associazione partner, se applicabile
operatore_id        INTEGER     FK → utenti.id
volontario_id       INTEGER     FK → volontari.id (nullable)
mezzo_id            INTEGER     FK → mezzi.id (nullable)
stato               VARCHAR(20) DEFAULT 'bozza'
                    -- valori: 'bozza', 'confermato', 'consegnato', 'annullato'
path_pdf            VARCHAR(300)  -- path relativo al PDF generato
conferma_ricezione  BOOLEAN     DEFAULT FALSE
note_ricezione      TEXT
firma_note          TEXT          -- spazio per annotazione firma manuale
data_creazione      DATETIME    DEFAULT NOW
creato_da           INTEGER     FK → utenti.id
```

---

### TABELLA: `documento_righe`

Dettaglio prodotti di ogni documento logistico.
Sostituisce e unifica `bolla_righe` nel caso di bolle,
e `trasferimento_righe` per i documenti di trasferimento.
Le bolle usano ancora `bolla_righe` per compatibilità, ma ogni bolla
è anche referenziata in `documenti_logistici`.

```
id                  INTEGER     PRIMARY KEY AUTOINCREMENT
documento_id        INTEGER     FK → documenti_logistici.id NOT NULL
prodotto_id         INTEGER     FK → prodotti.id NOT NULL
lotto_id            INTEGER     FK → lotti.id (nullable)
quantita            DECIMAL(10,2) NOT NULL
unita_misura        VARCHAR(20) NOT NULL
codice_barre        VARCHAR(50)   -- barcode commerciale o interno AIM
data_scadenza       DATE          -- copiata dal lotto al momento della generazione
magazzino_id        INTEGER     FK → magazzini.id NOT NULL
note                TEXT
```

---

### TABELLA: `trasferimenti`

```
id                  INTEGER     PRIMARY KEY AUTOINCREMENT
codice              VARCHAR(30) NOT NULL UNIQUE
magazzino_origine_id    INTEGER FK → magazzini.id NOT NULL
magazzino_destino_id    INTEGER FK → magazzini.id NOT NULL
data_richiesta      DATE        NOT NULL
data_esecuzione     DATE
data_conferma_ricezione DATE      -- data in cui il magazzino di destinazione conferma
operatore_id        INTEGER     FK → utenti.id
stato               VARCHAR(20) DEFAULT 'richiesto'
                    -- valori: 'richiesto', 'preparato', 'in_transito',
                    --         'completato', 'annullato'
                    -- ATTENZIONE: il carico nel magazzino di destinazione
                    -- avviene SOLO quando lo stato passa a 'completato',
                    -- dopo conferma esplicita della ricezione da parte del
                    -- responsabile del magazzino destinatario.
documento_id        INTEGER     FK → documenti_logistici.id (nullable)
note                TEXT
data_creazione      DATETIME    DEFAULT NOW
creato_da           INTEGER     FK → utenti.id
```

---

### TABELLA: `trasferimento_righe`

Dettaglio prodotti di ogni trasferimento (one-to-many su `trasferimenti`).

```
id                  INTEGER     PRIMARY KEY AUTOINCREMENT
trasferimento_id    INTEGER     FK → trasferimenti.id NOT NULL
prodotto_id         INTEGER     FK → prodotti.id NOT NULL
lotto_id            INTEGER     FK → lotti.id (nullable)
quantita            DECIMAL(10,2) NOT NULL
unita_misura        VARCHAR(20) NOT NULL
note                TEXT
```

---

### TABELLA: `approvvigionamenti`

```
id                  INTEGER     PRIMARY KEY AUTOINCREMENT
codice              VARCHAR(30) NOT NULL UNIQUE
fornitore_id        INTEGER     FK → fornitori.id (nullable)
data_richiesta      DATE        NOT NULL
data_prevista       DATE
operatore_id        INTEGER     FK → utenti.id
stato               VARCHAR(30) DEFAULT 'bozza'
                    -- valori: 'bozza', 'inviata', 'confermata',
                    --         'parziale', 'completata', 'annullata'
note                TEXT
data_creazione      DATETIME    DEFAULT NOW
creato_da           INTEGER     FK → utenti.id
```

---

### TABELLA: `approvvigionamento_righe`

```
id                      INTEGER     PRIMARY KEY AUTOINCREMENT
approvvigionamento_id   INTEGER     FK → approvvigionamenti.id NOT NULL
prodotto_id             INTEGER     FK → prodotti.id NOT NULL
quantita_richiesta      DECIMAL(10,2) NOT NULL
quantita_ricevuta       DECIMAL(10,2) DEFAULT 0
unita_misura            VARCHAR(20) NOT NULL
note                    TEXT
```

---

### TABELLA: `beneficiari`

Scheda sociale digitale completa.

```
id                          INTEGER     PRIMARY KEY AUTOINCREMENT
codice                      VARCHAR(20) NOT NULL UNIQUE
codice_protocollo           VARCHAR(30)
cognome                     VARCHAR(80) NOT NULL
nome                        VARCHAR(80) NOT NULL
data_nascita                DATE
luogo_nascita               VARCHAR(100)
codice_fiscale              VARCHAR(20)
cittadinanza                VARCHAR(60)
residenza                   VARCHAR(200)
domicilio                   VARCHAR(200)
comune                      VARCHAR(80)
zona_municipio              VARCHAR(80)
telefono                    VARCHAR(20)
email                       VARCHAR(120)
lingua_parlata              VARCHAR(60)
-- Stato civile
stato_civile                VARCHAR(30)
                            -- valori: 'celibe_nubile', 'coniugato', 'separato',
                            --         'divorziato', 'vedovo', 'altro'
-- Nucleo familiare (dati aggregati)
composizione_nucleo         VARCHAR(50)
                            -- valori: 'solo', 'con_coniuge', 'con_coniuge_figli',
                            --         'con_figli', 'con_genitori', 'con_familiari', 'altro'
num_componenti              INTEGER     DEFAULT 1
num_figli_maschi            INTEGER     DEFAULT 0
num_figli_femmine           INTEGER     DEFAULT 0
num_minori                  INTEGER     DEFAULT 0
num_anziani                 INTEGER     DEFAULT 0
num_disabili                INTEGER     DEFAULT 0
note_famiglia               TEXT
-- Esigenze alimentari e personali
restrizioni_alimentari      TEXT
allergie                    TEXT
intolleranze                TEXT
alimenti_da_evitare         TEXT
alimenti_consigliati        TEXT
note_pacco_alimentare       TEXT
-- Situazione socioeconomica (campi sensibili — visibili solo a operatori autorizzati)
pensione_sostegno           VARCHAR(20)  DEFAULT 'non_dichiarato'
                            -- valori: 'si', 'no', 'non_dichiarato'
reddito_cittadinanza        VARCHAR(20)  DEFAULT 'non_dichiarato'
invalidita_civile           VARCHAR(20)  DEFAULT 'non_dichiarato'
                            -- valori: 'si', 'no', 'in_corso', 'non_dichiarato'
percentuale_invalidita      VARCHAR(10)
indennita_accompagnamento   VARCHAR(10)  DEFAULT 'non_dichiarato'
legge_104                   VARCHAR(10)  DEFAULT 'non_dichiarato'
servizi_sociali             VARCHAR(10)  DEFAULT 'non_dichiarato'
servizio_sociale_riferimento VARCHAR(150)
assistente_sociale          VARCHAR(100)
contatto_servizio_sociale   VARCHAR(100)
-- Servizi in atto (stringa JSON con lista servizi attivi)
servizi_in_atto             TEXT        -- JSON array
-- Condizione di fragilità
motivazioni_intervento      TEXT
problemi_bisogni            TEXT
proposta_intervento         TEXT
osservazioni_generali       TEXT
stato_salute_osservato      TEXT
stato_emotivo_osservato     TEXT
supporto_psicologico        VARCHAR(20)  DEFAULT 'non_dichiarato'
consegna_domicilio          BOOLEAN     DEFAULT FALSE
motivo_consegna_domicilio   VARCHAR(60)
                            -- valori: 'allettato', 'disabilita', 'anziano_solo',
                            --         'impossibilita_spostamento', 'senza_mezzo', 'altro'
priorita                    VARCHAR(10)  DEFAULT 'media'
                            -- valori: 'bassa', 'media', 'alta', 'urgente'
-- Metadati
attivo                      BOOLEAN     DEFAULT TRUE
data_presa_in_carico        DATE
operatore_id                INTEGER     FK → utenti.id
data_creazione              DATETIME    DEFAULT NOW
data_aggiornamento          DATETIME    DEFAULT NOW
creato_da                   INTEGER     FK → utenti.id
aggiornato_da               INTEGER     FK → utenti.id
note_interne                TEXT
```

---

### TABELLA: `nucleo_familiare`

Un record per ogni componente del nucleo del beneficiario.

```
id                  INTEGER     PRIMARY KEY AUTOINCREMENT
beneficiario_id     INTEGER     FK → beneficiari.id NOT NULL
nome                VARCHAR(80)
cognome             VARCHAR(80)
data_nascita        DATE
relazione           VARCHAR(60)
                    -- valori: 'coniuge', 'figlio', 'figlia', 'genitore',
                    --         'fratello', 'sorella', 'nonno', 'altro'
taglia_vestiti      VARCHAR(20)
numero_scarpe       VARCHAR(10)
esigenze_particolari TEXT
note                TEXT
```

---

### TABELLA: `persone_significative`

Persone o enti che prestano supporto al beneficiario.

```
id                  INTEGER     PRIMARY KEY AUTOINCREMENT
beneficiario_id     INTEGER     FK → beneficiari.id NOT NULL
tipo_relazione      VARCHAR(60)
nominativo          VARCHAR(120)
contatto            VARCHAR(100)
indirizzo           VARCHAR(200)
note                TEXT
```

---

### TABELLA: `interventi`

Storico degli interventi sociali.

```
id                  INTEGER     PRIMARY KEY AUTOINCREMENT
beneficiario_id     INTEGER     FK → beneficiari.id NOT NULL
data_intervento     DATE        NOT NULL
tipo_intervento     VARCHAR(50) NOT NULL
                    -- valori: 'colloquio_accoglienza', 'colloquio_aggiornamento',
                    --   'pacco_alimentare', 'prodotti_igiene', 'vestiario',
                    --   'scarpe', 'supporto_psicologico', 'orientamento_servizi',
                    --   'segnalazione_servizi', 'accompagnamento',
                    --   'visita_domiciliare', 'contatto_telefonico', 'altro'
operatore_id        INTEGER     FK → utenti.id
descrizione         TEXT
esito               TEXT
prossima_azione     TEXT
data_followup       DATE
note_riservate      TEXT        -- visibili solo a operatori autorizzati
data_creazione      DATETIME    DEFAULT NOW
creato_da           INTEGER     FK → utenti.id
```

---

### TABELLA DI ASSOCIAZIONE: `intervento_volontari`

Volontari coinvolti in un intervento (many-to-many).

```
id              INTEGER     PRIMARY KEY AUTOINCREMENT
intervento_id   INTEGER     FK → interventi.id NOT NULL
volontario_id   INTEGER     FK → volontari.id NOT NULL
```

---

### TABELLA: `volontari`

```
id                      INTEGER     PRIMARY KEY AUTOINCREMENT
nome                    VARCHAR(80) NOT NULL
cognome                 VARCHAR(80) NOT NULL
telefono                VARCHAR(20)
email                   VARCHAR(120)
ruolo                   VARCHAR(40)
                        -- valori: 'accoglienza', 'magazziniere', 'autista',
                        --         'consegnatario', 'coordinatore',
                        --         'amministratore', 'altro'
disponibilita           TEXT        -- JSON: {lun: 'mattina', mar: null, ...}
zone_coperte            TEXT        -- JSON array di zone
patente                 BOOLEAN     DEFAULT FALSE
mezzo_personale         BOOLEAN     DEFAULT FALSE
mezzo_id                INTEGER     FK → mezzi.id (nullable)
max_consegne_turno      INTEGER     DEFAULT 5
attivo                  BOOLEAN     DEFAULT TRUE
note                    TEXT
utente_id               INTEGER     FK → utenti.id (nullable — se ha accesso al sistema)
data_creazione          DATETIME    DEFAULT NOW
creato_da               INTEGER     FK → utenti.id
```

---

### TABELLA: `mezzi`

```
id                      INTEGER     PRIMARY KEY AUTOINCREMENT
codice                  VARCHAR(20) NOT NULL UNIQUE
tipo                    VARCHAR(20) NOT NULL
                        -- valori: 'auto', 'moto', 'scooter', 'furgone',
                        --         'cargo_bike', 'altro'
targa                   VARCHAR(15)
proprieta               VARCHAR(20) NOT NULL
                        -- valori: 'associazione', 'volontario', 'terzo'
proprietario_nome       VARCHAR(120)
volontario_id           INTEGER     FK → volontari.id (nullable)
capacita_colli          INTEGER
capacita_kg             DECIMAL(8,2)
capacita_volume         DECIMAL(8,2)
stato                   VARCHAR(20) DEFAULT 'disponibile'
                        -- valori: 'disponibile', 'assegnato',
                        --         'manutenzione', 'non_disponibile'
scadenza_assicurazione  DATE
scadenza_revisione      DATE
note                    TEXT
data_creazione          DATETIME    DEFAULT NOW
creato_da               INTEGER     FK → utenti.id
```

---

### TABELLA: `consegne`

```
id                      INTEGER     PRIMARY KEY AUTOINCREMENT
codice                  VARCHAR(30) NOT NULL UNIQUE
beneficiario_id         INTEGER     FK → beneficiari.id NOT NULL
tipo_consegna           VARCHAR(20) NOT NULL
                        -- valori: 'in_sede', 'domicilio', 'ritiro_programmato'
data_prevista           DATE        NOT NULL
fascia_oraria           VARCHAR(30)
indirizzo_consegna      VARCHAR(200)
zona                    VARCHAR(80)
magazzino_id            INTEGER     FK → magazzini.id NOT NULL
volontario_id           INTEGER     FK → volontari.id (nullable)
mezzo_id                INTEGER     FK → mezzi.id (nullable)
stato                   VARCHAR(20) DEFAULT 'pianificata'
                        -- valori: 'pianificata', 'preparazione', 'in_corso',
                        --         'effettuata', 'mancata', 'ripianificata', 'annullata'
motivo_mancata          TEXT
bolla_id                INTEGER     FK → bolle.id (nullable — generata dopo)
operatore_id            INTEGER     FK → utenti.id
note_operative          TEXT
data_effettuata         DATETIME
data_creazione          DATETIME    DEFAULT NOW
creato_da               INTEGER     FK → utenti.id
```

---

### TABELLA: `consegna_prodotti`

Prodotti previsti per una consegna (many-to-many con quantità).

```
id              INTEGER     PRIMARY KEY AUTOINCREMENT
consegna_id     INTEGER     FK → consegne.id NOT NULL
prodotto_id     INTEGER     FK → prodotti.id NOT NULL
lotto_id        INTEGER     FK → lotti.id (nullable)
quantita        DECIMAL(10,2) NOT NULL
unita_misura    VARCHAR(20) NOT NULL
note            TEXT
```

---

### TABELLA: `bolle`

```
id                      INTEGER     PRIMARY KEY AUTOINCREMENT
numero_bolla            VARCHAR(30) NOT NULL UNIQUE
                        -- Formato: BOLLA-YYYY-NNNN (es. BOLLA-2024-0001)
data_bolla              DATE        NOT NULL
ora_bolla               TIME        NOT NULL  -- ora di emissione (richiesta dalla spec.)
beneficiario_id         INTEGER     FK → beneficiari.id NOT NULL
consegna_id             INTEGER     FK → consegne.id (nullable)
documento_id            INTEGER     FK → documenti_logistici.id (nullable)
magazzino_id            INTEGER     FK → magazzini.id NOT NULL
indirizzo_consegna      VARCHAR(200)
operatore_id            INTEGER     FK → utenti.id
volontario_consegna_id  INTEGER     FK → volontari.id (nullable)
mezzo_id                INTEGER     FK → mezzi.id (nullable)
stato                   VARCHAR(20) DEFAULT 'bozza'
                        -- valori: 'bozza', 'confermato', 'consegnato', 'annullato'
                        -- (allineato con documenti_logistici.stato)
note_consegna           TEXT
conferma_ricezione      BOOLEAN     DEFAULT FALSE
note_ricezione          TEXT
firma_note              TEXT        -- annotazione firma manuale ("firmato da Mario R.")
path_pdf                VARCHAR(300)  -- path relativo al PDF della bolla
data_creazione          DATETIME    DEFAULT NOW
creato_da               INTEGER     FK → utenti.id
```

---

### TABELLA: `bolla_righe`

Prodotti contenuti in una bolla (one-to-many su `bolle`).

```
id              INTEGER     PRIMARY KEY AUTOINCREMENT
bolla_id        INTEGER     FK → bolle.id NOT NULL
prodotto_id     INTEGER     FK → prodotti.id NOT NULL
lotto_id        INTEGER     FK → lotti.id (nullable)
quantita        DECIMAL(10,2) NOT NULL
unita_misura    VARCHAR(20) NOT NULL
magazzino_id    INTEGER     FK → magazzini.id NOT NULL
note            TEXT
```

---

## DIAGRAMMA RELAZIONI PRINCIPALI

```
utenti ──────────────────────────────────────────────┐
  │                                                   │ (creato_da / operatore_id)
  ▼                                                   │
magazzini ←──────── lotti ─────────────────────────► prodotti
    │                  │                                  │
    │                  │                                  │
    ▼                  ▼                                  ▼
movimenti ◄────── trasferimenti ──────► documenti_logistici
    │                                           │
    ▼                                           ▼
bolle ◄──── bolla_righe ──────────► prodotti ◄──── barcode_interni
  │   │                                  │
  │   └──────────────────────────► lotti │
  │                                       │
  └───► documenti_logistici ◄─────────────┘
            │
            └──► documento_righe ──► prodotti, lotti
  │
  └───► consegne ◄──── consegna_prodotti ──► prodotti
            │
            ├──► volontari ◄──── mezzi
            │
            └──► beneficiari ◄── nucleo_familiare
                     │           persone_significative
                     └──► interventi ◄── intervento_volontari
                                               │
                                               └──► volontari

approvvigionamenti ◄── approvvigionamento_righe ──► prodotti
      │
      └──► fornitori ◄──────────────────────────── prodotti
```

---

## LOGICA DI BUSINESS CRITICA

### 1. Gestione giacenze

Non usare una tabella separata per le giacenze.
Le giacenze si calcolano **sempre in tempo reale** dalla tabella `lotti`:

```python
# Giacenza di un prodotto in un magazzino
giacenza = db.session.query(
    func.sum(Lotto.quantita_residua)
).filter(
    Lotto.prodotto_id == prodotto_id,
    Lotto.magazzino_id == magazzino_id,
    Lotto.quantita_residua > 0
).scalar() or 0
```

### 2. Logica FEFO (First Expired, First Out)

Per i prodotti alimentari, al momento dello scarico, il sistema deve:
1. Proporre automaticamente i lotti con scadenza più vicina
2. Mostrare una tabella con: lotto, scadenza, quantità disponibile, magazzino
3. Pre-compilare il form con la selezione FEFO consigliata evidenziata in verde
4. Permettere la selezione manuale di un lotto diverso, con messaggio di avviso
   ("Stai scegliendo un lotto con scadenza più lontana. Sei sicuro?")
5. Registrare nel movimento se la scelta FEFO è stata rispettata o ignorata

```python
def get_lotti_fefo(prodotto_id, magazzino_id, quantita_richiesta):
    """
    Restituisce la lista di lotti da scaricare in ordine FEFO.
    Priorità: lotti con data_scadenza più vicina per primi.
    Lotti senza scadenza vengono messi in fondo (nullslast).
    Esclude lotti con quantita_residua = 0.
    Restituisce anche un flag 'fefo_consigliato' = True sul primo lotto.
    """
    lotti = Lotto.query.filter(
        Lotto.prodotto_id == prodotto_id,
        Lotto.magazzino_id == magazzino_id,
        Lotto.quantita_residua > 0
    ).order_by(
        Lotto.data_scadenza.asc().nullslast()
    ).all()
    return lotti
```

### 3. Controllo disponibilità prima dello scarico

```python
def verifica_disponibilita(prodotto_id, magazzino_id, quantita):
    """
    Verifica che ci sia sufficiente quantita disponibile.
    Solleva un ValueError con messaggio comprensibile se non disponibile.
    """
    disponibile = calcola_giacenza(prodotto_id, magazzino_id)
    if disponibile < quantita:
        raise ValueError(
            f"Quantità non sufficiente. Disponibile: {disponibile}, "
            f"richiesta: {quantita}."
        )
```

### 4. Numero bolla progressivo

```python
def genera_numero_bolla():
    """
    Formato: BOLLA-YYYY-NNNN (es. BOLLA-2024-0001)
    """
    anno = datetime.now().year
    ultimo = db.session.query(func.max(Bolla.numero_bolla)).filter(
        Bolla.numero_bolla.like(f'BOLLA-{anno}-%')
    ).scalar()
    if ultimo:
        n = int(ultimo.split('-')[-1]) + 1
    else:
        n = 1
    return f"BOLLA-{anno}-{n:04d}"
```

### 5. Completamento consegna (operazione atomica)

Quando una consegna passa allo stato `effettuata`, il sistema deve:
1. Per ogni prodotto nella `consegna_prodotti`: scaricare dal lotto corrispondente
2. Creare i `movimenti` di tipo `scarico` con `tipo_dettaglio = 'consegna_domicilio'`
3. Creare o aggiornare la `bolle` associata
4. Popolare `bolla_righe` con i prodotti consegnati
5. Creare il record in `documenti_logistici` di tipo `'bolla_consegna'`
6. Generare automaticamente il PDF della bolla e salvarne il path
7. Creare un `interventi` di tipo `'pacco_alimentare'` nello storico del beneficiario
8. Liberare il mezzo (aggiornare stato mezzo a `disponibile`)
9. Tutto in una singola transazione `db.session` con rollback in caso di errore

### 6. Ciclo di vita del trasferimento tra magazzini (2 fasi)

Il trasferimento funziona in **due fasi distinte** per garantire la corretta
tracciabilità della merce in transito:

**FASE 1 — Partenza (stato: `in_transito`)**
- Lo scarico dal magazzino di origine avviene immediatamente
- Viene generato il documento di trasferimento (PDF con elenco prodotti, lotti, quantità)
- La merce risulta "in viaggio": non è più nel magazzino di partenza
  ma non è ancora conteggiata nel magazzino di destinazione

**FASE 2 — Ricezione (stato: `completato`)**
- Il responsabile del magazzino destinatario conferma la ricezione
- Solo a questo punto il sistema carica i prodotti nel magazzino di destinazione
- Viene aggiornato il documento con data di conferma ricezione
- Se la quantità ricevuta differisce da quella inviata, l'operatore può inserire
  una nota di discrepanza

```python
def esegui_fase1_trasferimento(trasferimento_id, operatore_id):
    """
    Fase 1: scarica dal magazzino origine, genera documento PDF, stato → in_transito.
    Operazione atomica con rollback.
    """

def conferma_ricezione_trasferimento(trasferimento_id, operatore_id, note=None):
    """
    Fase 2: carica nel magazzino destinazione, aggiorna documento, stato → completato.
    Operazione atomica con rollback.
    """
```

### 7. Generazione documenti logistici (`modules/documenti.py`)

Ogni tipo di movimento genera un documento PDF con struttura specifica.
Tutti i PDF sono generati con FPDF2.

```python
def genera_documento(tipo, record_id):
    """
    Factory function. Riceve il tipo di documento e l'id del record
    (bolla_id, trasferimento_id, movimento_id).
    Chiama la funzione specifica per il tipo.
    Salva il PDF in exports/pdf/{tipo}_{numero}_{timestamp}.pdf
    Aggiorna il campo path_pdf nel record.
    Restituisce il path del file generato.
    """

def genera_pdf_bolla(bolla_id):
    """
    Layout PDF bolla di consegna:
    - Header: logo associazione + "BOLLA DI CONSEGNA N° BOLLA-YYYY-NNNN"
    - Data e ora emissione
    - Dati beneficiario (nome, indirizzo consegna, codice)
    - Magazzino di partenza
    - Operatore e volontario consegnatario
    - Mezzo utilizzato
    - Tabella prodotti: codice | descrizione | lotto | scadenza | q.tà | u.m. | barcode
    - Note consegna
    - Spazio firma manuale: "Firma del consegnatario: ________________"
    - Footer: data stampa, versione app
    """

def genera_pdf_trasferimento(trasferimento_id):
    """
    Layout PDF documento di trasferimento interno:
    - Header: "DOCUMENTO DI TRASFERIMENTO INTERNO N° TRASM-YYYY-NNNN"
    - Data richiesta e data esecuzione
    - Magazzino di partenza → Magazzino di destinazione
    - Operatore incaricato
    - Tabella prodotti: codice | descrizione | lotto | scadenza | q.tà | u.m.
    - Stato: In transito / Completato
    - Spazio per firma del responsabile del magazzino destinatario
    - Note
    """

def genera_pdf_carico(movimento_id):
    """
    Layout PDF documento di carico:
    - Header: "DOCUMENTO DI ENTRATA MERCE"
    - Tipo carico (acquisto / donazione / banco alimentare / raccolta)
    - Fornitore/donatore
    - Magazzino di destinazione
    - Data e operatore
    - Tabella prodotti con lotto e scadenza
    - Riferimento documento (DDT, ricevuta donazione)
    """

def genera_pdf_scarico_speciale(movimento_id):
    """
    Per scarichi di tipo: scaduto, danneggiato, non_distribuibile.
    Layout: "VERBALE DI SCARICO MERCE"
    Include motivazione, prodotti, quantità, lotti, note operative.
    """
```

### 8. Controllo conflitti mezzo

```python
def mezzo_disponibile(mezzo_id, data, fascia_oraria):
    """
    Verifica che il mezzo non sia già assegnato
    a un'altra consegna nella stessa data e fascia oraria.
    """
    conflitto = Consegna.query.filter(
        Consegna.mezzo_id == mezzo_id,
        Consegna.data_prevista == data,
        Consegna.fascia_oraria == fascia_oraria,
        Consegna.stato.in_(['pianificata', 'preparazione', 'in_corso'])
    ).first()
    return conflitto is None
```

---

## INTERFACCIA GUIDATA PER VOLONTARI NON TECNICI

### Principi generali UX

Tutte le procedure operative devono essere guidate e a prova di errore:

**Wizard a step per le operazioni complesse:**
- Nuova consegna: Step 1 (beneficiario) → Step 2 (prodotti con FEFO) → Step 3 (mezzo/volontario) → Riepilogo e conferma
- Nuovo trasferimento: Step 1 (magazzini) → Step 2 (prodotti e lotti) → Step 3 (riepilogo e documento)
- Carico merce: Step 1 (tipo carico/fornitore) → Step 2 (prodotti con lotto e scadenza) → Step 3 (conferma)

**Controlli automatici in tempo reale (via endpoint API):**

```javascript
// Esempio: verifica disponibilità prima di confermare lo scarico
// In main.js, usare fetch() sugli endpoint /api/v1/ per validazione lato client
// prima ancora della validazione lato server

async function verificaDisponibilita(prodottoId, magazzinoId, quantita) {
    const r = await fetch(`/api/v1/giacenze/${magazzinoId}?prodotto=${prodottoId}`);
    const data = await r.json();
    if (data.disponibile < quantita) {
        mostraAlert('danger', `Quantità non sufficiente. Disponibile: ${data.disponibile}`);
        return false;
    }
    return true;
}
```

**Messaggi di conferma per operazioni irreversibili:**
- Mostrare un modal Bootstrap di conferma con riepilogo dell'operazione
- Usare colori semantici: verde = operazione sicura, rosso = operazione irreversibile
- Esempio testo modal: "Stai per completare la consegna a Mario Rossi.
  Verranno scaricati 3 prodotti dal magazzino Sede Centrale.
  Questa operazione non può essere annullata. Confermi?"

**Suggerimento FEFO visibile a schermo:**
- Nel form di scarico/consegna, mostrare sempre una tabella con i lotti disponibili
- Evidenziare in verde il lotto FEFO consigliato
- Mostrare un badge "⚠️ In scadenza" per lotti con scadenza entro 7 giorni
- Mostrare un badge "🔴 Scaduto" per lotti già scaduti (da non usare per distribuzione)

**Controlli pre-salvataggio lato server (da implementare in ogni route POST):**
1. Quantità disponibile ≥ quantità richiesta (per scarichi)
2. Mezzo non già impegnato nella stessa fascia oraria (per consegne)
3. Magazzino di partenza ≠ magazzino di destinazione (per trasferimenti)
4. Beneficiario attivo (non disattivato) prima di creare consegna
5. Lotto non scaduto prima di includerlo in una consegna a beneficiario



---

## MODULO PREDITTIVO (`modules/predizione.py`)

Nessuna libreria esterna AI. Logica Python pura.

```python
def stima_fabbisogno_beneficiario(beneficiario_id, mesi=3):
    """
    Analizza gli ultimi `mesi` mesi di interventi del beneficiario.
    Calcola la media mensile per categoria di prodotto.
    Suggerisce una nuova consegna se l'ultima è troppo lontana nel tempo.

    Restituisce:
    {
      'beneficiario': {...},
      'media_consegne_mese': float,
      'giorni_ultima_consegna': int,
      'suggerimento': str,       # spiegazione in linguaggio naturale
      'azione_consigliata': str  # 'consegna_entro_X_giorni' o 'nessuna'
    }
    """

def stima_fabbisogno_magazzino(magazzino_id, mesi=3):
    """
    Aggrega i consumi degli ultimi `mesi` mesi per il magazzino.
    Calcola media mobile per prodotto.
    Confronta con giacenza attuale.

    Restituisce lista di prodotti con:
    - consumo_medio_mensile
    - giacenza_attuale
    - giorni_copertura_stimati
    - quantita_suggerita_riordino
    - urgenza: 'critica', 'alta', 'media', 'bassa'
    """

def lista_prodotti_da_riordinare():
    """
    Combina giacenze sotto scorta minima + previsione consumi.
    Restituisce lista ordinata per urgenza.
    """

def beneficiari_senza_followup(giorni=30):
    """
    Restituisce i beneficiari attivi che non hanno ricevuto
    nessun intervento negli ultimi `giorni` giorni.
    Considera priorità alta/urgente come soglia ridotta (15 giorni).
    """

def suggerimento_raggruppamento_consegne():
    """
    Raggruppa le consegne pianificate per zona geografica.
    Suggerisce un ordine ottimale per minimizzare gli spostamenti.
    Logica semplice: ordinamento per zona/municipio.
    """
```

Ogni funzione deve **sempre restituire una spiegazione testuale** del ragionamento,
non solo il dato numerico. Esempio:

> "Il beneficiario Mario Rossi (nucleo di 4 persone) ha ricevuto l'ultimo pacco
> alimentare 28 giorni fa. La media degli ultimi 3 mesi è di 1 consegna ogni
> 14 giorni. Si suggerisce una nuova consegna entro 3 giorni."

---

## AUTENTICAZIONE E RUOLI (`modules/auth.py`)

### Ruoli e permessi

```
RUOLO                   | Dashboard | Beneficiari | Magazzino | Consegne | Utenti | Report | Note riservate
------------------------|-----------|-------------|-----------|----------|--------|--------|---------------
amministratore          |    ✓      |    ✓        |    ✓      |    ✓     |   ✓    |   ✓    |      ✓
coordinatore            |    ✓      |    ✓        |    ✓      |    ✓     |   ✗    |   ✓    |      ✓
operatore_sociale       |    ✓      |    ✓        |  lettura  |    ✓     |   ✗    |  base  |      ✓
magazziniere            |    ✓      |  lettura    |    ✓      |  lettura |   ✗    |  base  |      ✗
volontario_consegne     | parziale  |  minima     |    ✗      | proprie  |   ✗    |   ✗    |      ✗
sola_lettura            |    ✓      |  lettura    |  lettura  |  lettura |   ✗    |  base  |      ✗
```

### Implementazione

- Usa `Flask-Login` con `current_user` in tutti i template
- Usa un decorator `@ruolo_richiesto('amministratore', 'coordinatore')` da applicare alle route
- L'utente admin di default viene creato alla prima esecuzione con credenziali da `.env`
- Hash password con `werkzeug.security.generate_password_hash(method='pbkdf2:sha256')`

```python
# Esempio decorator
def ruolo_richiesto(*ruoli):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if not current_user.is_authenticated:
                return redirect(url_for('auth.login'))
            if current_user.ruolo not in ruoli:
                flash('Accesso non autorizzato.', 'danger')
                return redirect(url_for('dashboard.index'))
            return f(*args, **kwargs)
        return decorated_function
    return decorator
```

---

## TEMPLATE BASE (`templates/base.html`)

Struttura HTML Bootstrap 5 con:
- Navbar laterale (sidebar) con menu principale
- Topbar con nome utente, ruolo e logout
- Area contenuto principale con breadcrumb
- Zona alert/flash messages (success, warning, danger, info)
- Footer con versione app

**Menu sidebar in italiano:**
```
🏠 Dashboard
📦 Magazzini
🏷️ Prodotti
⬆️ Carico merce
⬇️ Scarico merce
🔄 Trasferimenti
📊 Giacenze
⚠️ Scadenze
🤝 Fornitori
🛒 Approvvigionamenti
📄 Documenti logistici
🔖 Barcode ed etichette
──────────────────
👥 Beneficiari
💬 Interventi
📋 Bolle di consegna
🚚 Consegne
📅 Calendario
🚐 Mezzi
👋 Volontari
──────────────────
📈 Report
🤖 Previsioni AI
──────────────────
⚙️ Impostazioni
```

---

## DASHBOARD (`modules/dashboard.py`)

La dashboard deve mostrare **widget riepilogo** calcolati in tempo reale:

```python
def get_dashboard_data():
    oggi = date.today()
    return {
        'beneficiari_attivi': Beneficiario.query.filter_by(attivo=True).count(),
        'consegne_oggi': Consegna.query.filter_by(data_prevista=oggi).count(),
        'consegne_da_completare': Consegna.query.filter(
            Consegna.stato.in_(['pianificata', 'preparazione', 'in_corso'])
        ).count(),
        'prodotti_sotto_scorta': get_prodotti_sotto_scorta(),
        'scadenze_7gg': get_lotti_in_scadenza(giorni=7),
        'scadenze_15gg': get_lotti_in_scadenza(giorni=15),
        'scadenze_30gg': get_lotti_in_scadenza(giorni=30),
        'magazzini_attivi': Magazzino.query.filter_by(stato='attivo').count(),
        'mezzi_disponibili': Mezzo.query.filter_by(stato='disponibile').count(),
        'alert_critici': get_alert_critici(),
    }
```

Gli **alert critici** devono apparire come banner colorati in cima alla dashboard:
- 🔴 Prodotti scaduti presenti in magazzino
- 🟠 Prodotti sotto scorta minima
- 🟡 Consegne pianificate non effettuate da più di 2 giorni
- 🔵 Beneficiari senza follow-up da più di 30 giorni (alta priorità: 15 giorni)
- 🟣 Trasferimenti in stato `in_transito` da più di 2 giorni senza conferma ricezione

---

## ENDPOINT API JSON (`modules/api.py`)

Prefisso: `/api/v1/`

```
GET  /api/v1/consegne/calendario              → JSON per FullCalendar
GET  /api/v1/prodotti/cerca?q=QUERY           → ricerca prodotti (autocomplete)
GET  /api/v1/beneficiari/cerca?q=QUERY        → ricerca beneficiari (autocomplete)
GET  /api/v1/giacenze/<magazzino_id>          → giacenze magazzino in JSON
GET  /api/v1/giacenze/<magazzino_id>?prodotto=ID → giacenza singolo prodotto
GET  /api/v1/lotti/fefo/<prodotto_id>         → lotti suggeriti FEFO con flag consigliato
GET  /api/v1/mezzo/<id>/disponibile           → verifica disponibilità mezzo (JSON)
GET  /api/v1/predizione/riepilogo             → output predittivo riepilogativo
GET  /api/v1/barcode/<prodotto_id>            → info barcode prodotto (commerciale o AIM)
POST /api/v1/barcode/genera/<prodotto_id>     → genera barcode interno AIM
GET  /api/v1/documento/<id>/pdf               → download PDF documento logistico
POST /api/v1/trasferimento/<id>/conferma      → conferma ricezione trasferimento (fase 2)
```

Tutti gli endpoint richiedono autenticazione (`@login_required`).
Restituiscono JSON con struttura `{ "success": bool, "data": [...], "errore": str }`.

---

## CONFIG.PY

```python
import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'cambia-questa-chiave-in-produzione')
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        'DATABASE_URL', 'sqlite:///solidarity_warehouse.db'
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    DEBUG = os.environ.get('DEBUG', 'False') == 'True'
    MAX_CONTENT_LENGTH = 5 * 1024 * 1024   # 5MB max upload
    ITEMS_PER_PAGE = 25
    APP_NAME = "Magazzino Solidale AIM"
    APP_VERSION = "1.0.0"
    ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
    ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin1234')
    ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@aim.local')
    EXPORT_FOLDER = os.path.join(os.path.dirname(__file__), 'exports')
    UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
```

---

## .ENV.EXAMPLE

```
SECRET_KEY=inserisci-una-chiave-sicura-qui
DATABASE_URL=sqlite:///solidarity_warehouse.db
DEBUG=True
ADMIN_USERNAME=admin
ADMIN_PASSWORD=Admin1234!
ADMIN_EMAIL=admin@aim.local
```

---

## APP.PY — STRUTTURA PRINCIPALE

```python
from flask import Flask
from config import Config
from database import db, migrate
from flask_login import LoginManager
from modules.auth import auth_bp
from modules.dashboard import dashboard_bp
# ... import tutti i blueprint

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    db.init_app(app)
    migrate.init_app(app, db)

    login_manager = LoginManager()
    login_manager.init_app(app)
    login_manager.login_view = 'auth.login'
    login_manager.login_message = 'Effettua il login per accedere.'
    login_manager.login_message_category = 'warning'

    @login_manager.user_loader
    def load_user(user_id):
        from models import Utente
        return Utente.query.get(int(user_id))

    # Registra tutti i blueprint
    app.register_blueprint(auth_bp)
    app.register_blueprint(dashboard_bp)
    # ... tutti gli altri blueprint

    # Crea le tabelle e l'utente admin se non esistono
    with app.app_context():
        db.create_all()
        crea_admin_iniziale()

    return app

app = create_app()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
```

---

## SEED DATA (`seed_data.py`)

Eseguire con `python seed_data.py` **dopo** il primo avvio dell'app.
Non viene eseguito automaticamente all'avvio.

Deve creare:
- 2 magazzini (es. "Sede Centrale Via Roma" e "Punto Stoccaggio Nord")
- 5 categorie prodotto
- 10 prodotti alimentari con gestione lotto e scadenza
  (di cui 3 con barcode commerciale EAN e 7 con barcode interno AIM generato)
- 5 prodotti igiene senza scadenza (2 con barcode commerciale, 3 senza)
- 5 prodotti vestiario/scarpe con taglie (tutti senza barcode → generare AIM)
- 3 fornitori (1 banco alimentare, 1 azienda donatrice, 1 parrocchia)
- lotti di carico con scadenze distribuite nel tempo
  (alcuni già scaduti, alcuni in scadenza entro 7 giorni, alcuni ok)
- 5 beneficiari con nuclei familiari diversi
  (1 anziano solo, 1 famiglia con figli minori, 1 persona con disabilità,
   1 persona senza fissa dimora, 1 famiglia numerosa straniera)
- 3 volontari con ruoli diversi
- 2 mezzi dell'associazione (1 furgone, 1 auto)
- 2 mezzi personali di volontari
- 5 consegne pianificate nei prossimi 7 giorni
- 3 bolle già emesse con PDF generato
- 1 trasferimento in stato `in_transito` tra i due magazzini (per testare fase 2)
- 1 trasferimento `completato` con storico completo
- movimenti di carico e scarico per popolare lo storico
- 2 documenti di scarico speciale (1 scaduto, 1 danneggiato) con PDF
- 1 utente admin + 1 operatore + 1 magazziniere demo

---

## ISTRUZIONI PER AVVIARE IL PROGETTO SU REPLIT

```bash
# 1. Copia .env.example in .env e personalizza le credenziali
cp .env.example .env

# 2. Installa le dipendenze
pip install -r requirements.txt

# 3. Prima esecuzione: crea database e utente admin
python app.py
# oppure
flask db init
flask db migrate -m "Initial migration"
flask db upgrade

# 4. (Opzionale) Carica i dati demo
python seed_data.py

# 5. Avvia l'applicazione
python app.py
# oppure in produzione
gunicorn --bind 0.0.0.0:5000 app:app
```

**Credenziali di accesso default:**
- Username: `admin`
- Password: `Admin1234!`

---

## REPORT E ESPORTAZIONI (`modules/report.py`)

### Export CSV (con Pandas)

```python
def export_giacenze_csv(magazzino_id=None):
    """Esporta le giacenze in CSV. Se magazzino_id=None, esporta tutto."""

def export_beneficiari_csv():
    """Esporta l'elenco beneficiari (senza dati sensibili per ruoli limitati)."""

def export_movimenti_csv(da_data, a_data, magazzino_id=None):
    """Esporta i movimenti di magazzino nel periodo specificato."""

def export_documenti_csv(da_data, a_data, tipo_documento=None):
    """Esporta il registro dei documenti logistici emessi nel periodo."""
```

### Export PDF documenti logistici (con FPDF2)

I PDF dei documenti logistici sono generati da `modules/documenti.py` (vedi sezione
apposita nella logica di business). In `report.py` si aggiungono i PDF di riepilogo:

```python
def genera_pdf_giacenze(magazzino_id=None):
    """Genera PDF riepilogo giacenze con alert sotto scorta (semaforo colori)."""

def genera_pdf_scadenze():
    """Genera PDF prodotti in scadenza con semaforo: rosso/arancio/verde."""

def genera_pdf_registro_documenti(da_data, a_data):
    """
    Genera PDF registro cronologico di tutti i documenti logistici emessi.
    Colonne: numero, tipo, data, magazzino, beneficiario/partner, operatore, stato.
    """

def genera_pdf_etichette(prodotto_ids, colonne=3):
    """
    Genera PDF foglio etichette per la stampa su carta adesiva A4.
    Griglia: 3 colonne x 8 righe = 24 etichette per foglio (formato 70x37mm).
    Ogni etichetta: nome prodotto | codice | barcode (immagine PNG embedded nel PDF).
    Richiama barcode_manager.genera_barcode_interno() se il prodotto non ha barcode.
    Salva in exports/pdf/etichette_{timestamp}.pdf
    """
```

---

## GESTIONE INTERFACCIA — REGOLE GENERALI

Ogni pagina lista deve avere:
- Titolo pagina con badge contatore
- Pulsante "Nuovo" (solo per ruoli autorizzati)
- Barra di ricerca/filtro
- Tabella Bootstrap con righe alternate, header fisso
- Colonna azioni: Dettaglio, Modifica, (Elimina con conferma)
- Paginazione in fondo (25 elementi per pagina, configurabile)
- Pulsanti Esporta CSV e Esporta PDF

Messaggi di sistema sempre in italiano:
- Successo: verde (Bootstrap `alert-success`)
- Errore: rosso (Bootstrap `alert-danger`)
- Attenzione: giallo (Bootstrap `alert-warning`)
- Info: blu (Bootstrap `alert-info`)

Conferma prima di:
- Eliminare qualsiasi record
- Disattivare un beneficiario
- Annullare una consegna o bolla
- Completare un trasferimento (operazione irreversibile sui movimenti)

---

## INTERNAZIONALIZZAZIONE

Tutta l'interfaccia, i messaggi flash, le etichette dei form,
i messaggi di errore e i testi delle notifiche devono essere in **lingua italiana**.
Non usare Flask-Babel: semplicemente scrivere tutto in italiano direttamente
nei template Jinja2 e nei messaggi Python.

---

## NOTE FINALI SULLA PRIVACY

I campi contrassegnati come "sensibili" nella scheda beneficiario
(situazione economica, salute osservata, stato emotivo, note riservate negli interventi)
devono essere:
- Visibili solo ai ruoli: `amministratore`, `coordinatore`, `operatore_sociale`
- Nascosti o sostituiti con "*** dato riservato ***" per gli altri ruoli
- Mai inclusi negli export CSV accessibili a ruoli limitati

Implementa questa logica nei template Jinja2 con:
```jinja2
{% if current_user.ruolo in ['amministratore', 'coordinatore', 'operatore_sociale'] %}
    {{ beneficiario.stato_salute_osservato }}
{% else %}
    <span class="text-muted">Dato riservato</span>
{% endif %}
```

---

*Fine del prompt — Magazzino Solidale AIM v1.1*
*Progetto pensato per il volontariato sociale. Tutta l'interfaccia in italiano.*
*v1.1 — Aggiunto: gestione completa documenti logistici, barcode interni,*
*etichette stampabili, trasferimento a 2 fasi con conferma ricezione,*
*interfaccia guidata per volontari non tecnici, logica FEFO visuale.*
