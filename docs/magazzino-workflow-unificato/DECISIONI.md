# M0 — Decisioni progettuali validate

Validazione umana registrata il 9 settembre 2026 sulla baseline documentale del commit `2966e1f892b61a03760b6687bbc7bcb0e7b2e78b`. Una decisione approvata definisce il requisito per le milestone successive, ma **non** significa che codice, schema, API, migrazioni o test siano già stati realizzati. Le sezioni possono inoltre conservare dettagli progettuali demandati a una milestone futura, indicati separatamente dai requisiti già approvati.

## Esito della validazione umana M0

Sono approvati:

1. lotto logico di sistema `Generale` unico per Area operativa, sempre disponibile, non archiviabile e non assegnato retroattivamente al legacy;
2. proprietà di catalogo `quantitaFrazionabile`, con `pz`/`cf` non frazionabili e kg/litri frazionabili di default, senza arrotondamento del legacy;
3. pratica di carico persistente separata dalle contabilizzazioni incrementali immutabili;
4. `richiesta_magazzino` autonoma, valida anche con sole note e senza prodotti;
5. al massimo un documento operativo attivo e una pianificazione/consegna attiva per richiesta, conservando gli annullati nello storico;
6. stati interni `in_trasporto` e `rientro_atteso`, senza introdurre consegne parziali;
7. interfaccia basata su azioni operative semplici, senza esporre la complessità degli stati interni;
8. audit comune append-only e transazionale, attore dalla sessione backend, snapshot codice/matricola e correlation ID;
9. conservazione dell'autore nullo per il legacy e visualizzazione “Non disponibile — dato precedente”;
10. regola M1B per la scorta minima di Area descritta in D5, che esclude soglie aggregate arbitrarie.

Restano da definire nelle milestone indicate i dettagli implementativi, fra cui il nome del requisito di catalogo che renderà obbligatorio il codice lotto fisico quando la tracciabilità reale lo richiede e l'eventuale futura policy di soglia Area/prodotto×magazzino. Non sono decisioni che riaprono M0.

## Invarianti trasversali

1. Una bozza non modifica mai quantità, prenotazioni o giornale inventariale.
2. Ogni effetto inventariale è prodotto da un servizio di dominio transazionale e idempotente, non da una scrittura diretta su `movimenti`.
3. Catalogo globale non significa disponibilità globale: ogni quantità è letta e scritta nel contesto Area operativa ∩ magazzini autorizzati ∩ Centro/ulteriori vincoli.
4. La quantità disponibile non può essere negativa e non sottrae due volte prenotazioni già comprese nel richiesto.
5. Nessuna transizione distrugge o riscrive eventi già contabilizzati; correzioni e storni sono nuovi eventi collegati.
6. L'attore del comando deriva dalla sessione backend. Volontario o trasportatore incaricato è un ruolo operativo distinto.
7. Lotto logico, dettaglio fisico, documento e movimento hanno identità stabili diverse.
8. Una scadenza indicativa dell'attività non sostituisce la scadenza effettiva della merce.
9. Nessuna consegna parziale viene introdotta senza una decisione successiva esplicita.
10. URL e flussi legacy restano disponibili tramite adattatori/redirect finché il sostituto non è validato.

## D1 — Lotto logico e dettaglio fisico

**Decisione approvata.** Conservare l'attuale `lotti` come dettaglio/partita fisica e aggiungere in M2 un'entità superiore `lotto_logico` che descriva raccolta o attività multiprodotto.

Il **lotto logico/operativo** è ciò che il volontario seleziona durante carico, scarico e preparazione, per esempio `Generale`, `Raccolta PAM 12/09/2026` o `Donazione X`. Il **lotto fisico/produttore** è invece l'eventuale codice presente sulla confezione o sulla merce. Un lotto logico può contenere più prodotti e, per lo stesso prodotto, più dettagli fisici con scadenze diverse.

Relazioni proposte:

```text
lotto_logico (attività/raccolta, Area)
  1 ── n carico_pratica
  1 ── n lotti/dettagli_fisici

lotto/dettaglio_fisico
  ├─ prodotto
  ├─ magazzino
  ├─ fondo/provenienza e fornitore
  ├─ eventuale codice lotto fisico
  ├─ scadenza effettiva
  ├─ unità e fattore storicizzato
  └─ quantità caricata/residua
```

Il dettaglio fisico conserva un proprio ID e non viene fuso automaticamente con righe aventi gli stessi valori. Un eventuale consolidamento è ammesso solo da un servizio che confronti almeno prodotto, magazzino, lotto logico, fondo, provenienza/fornitore, codice lotto fisico normalizzato, scadenza effettiva, unità e fattore, mantenendo comunque il lineage dei carichi.

Il lotto logico contiene codice, descrizione, Area operativa, date indicative, note, stato e autori. La sua data termine/scadenza è organizzativa; il FEFO usa esclusivamente la scadenza effettiva del dettaglio fisico.

**Perché.** Il modello attuale è già una buona fonte fisica delle giacenze. Trasformarlo in contenitore multiprodotto romperebbe i riferimenti da righe, prenotazioni, movimenti, trasferimenti e rendicontazione.

**Alternativa scartata.** Rendere l'attuale `lotti` multiprodotto e spostare tutte le quantità altrove: migrazione più invasiva e rischio alto di perdita del lineage.

**Impatto.** Nuova relazione e migrazione conservativa in M2; adeguamento OpenAPI/client, carichi, viste giacenza e documenti successivi.

**Stato.** Implementazione verificata automaticamente e validata manualmente in M2 (`OK-M2/OK-MAN-M2`): schema, migrazione conservativa, servizio di carico, lifecycle API, audit e regressioni sono coperti. La UI operativa M3 e i completamenti M4 restano fuori dal perimetro validato.

### Lotto logico “Generale”

**Decisione approvata.** Un solo lotto logico di sistema “Generale” per ogni Area operativa, stabile, sempre disponibile e non archiviabile. È un vero lotto logico operativo di default, non è una partita fisica, non crea merce e non deve essere globale fra aree.

- È preselezionato per un carico privo di attività specifica, ma resta visibile e confermato prima della registrazione.
- Il codice lotto fisico/produttore è nullable e non diventa obbligatorio per il solo fatto che il prodotto partecipa alla gestione lotti del Magazzino Solidale; `Generale` non sostituisce né inventa tale codice.
- M2 definisce il requisito separato `lottoFisicoObbligatorio`: se `true` il codice fisico/produttore è obbligatorio; se `false` resta opzionale. Il precedente `gestioneLotto` è rinominato preservandone i valori e non governa il lotto logico.
- Anche senza codice lotto fisico viene creato un dettaglio distinto, perché quantità, magazzino, fondo, scadenza e lineage devono restare separati.
- I dati legacy non vengono assegnati retroattivamente a “Generale”: `lotto_logico_id` resta nullo con classificazione `legacy_non_ricostruibile` fino a una riconciliazione documentata.
- Un'Area legacy nulla non riceve automaticamente un “Generale”. Le nuove operazioni richiedono Area valida.

**Perché.** Un default globale attraverserebbe il confine territoriale e renderebbe ambigua la chiusura; un default per prodotto moltiplicherebbe contenitori privi di significato per il volontario.

**Stato.** Implementazione verificata automaticamente e validata manualmente in M2 (`OK-M2/OK-MAN-M2`): migrazione, nuove Aree e seed/demo creano un solo `Generale`; i 21 dettagli legacy restano null e le API ne proteggono struttura e lifecycle.

### Ciclo di vita

- `aperto`: riceve nuovi dettagli/carichi.
- `chiuso`: nessun nuovo carico ordinario; consultabile e riapribile con comando motivato/audit.
- `archiviato`: nascosto dai selettori ordinari ma sempre storico; solo se chiuso.
- `esaurito` è una condizione derivata, non uno stato scritto: somma residui a zero in tutti i magazzini e nessuna merce collegata in transito.
- “Mai caricato” è distinto: zero dettagli fisici, non “esaurito”.
- La riapertura non ricrea né modifica le partite esistenti.

Il lotto “Generale” non viene chiuso. Una raccolta ordinaria può essere chiusa anche con residuo, ma non viene dichiarata esaurita finché resta merce o transito.

### Regola lotto logico nei trasferimenti

**Decisione implementativa M2.** Alla ricezione di un trasferimento fra magazzini della stessa Area, il dettaglio fisico di destinazione conserva il `lottoLogicoId` sorgente, anche se il lotto è stato chiuso mentre la merce era già in transito. Se origine e destinazione appartengono ad Aree diverse, il dettaglio di destinazione viene invece associato al `Generale` dell'Area ricevente: non conserva un riferimento cross-Area, non resta senza lotto logico e non clona automaticamente il lotto nominativo sorgente.

La provenienza resta ricostruibile dal trasferimento, dai movimenti di uscita e ingresso e da `movimentoOrigineId`. Questa regola è verificata automaticamente in M2; visualizzazione completa, prenotazioni e gestione definitiva delle ulteriori condizioni di transito/rientro restano in LOT-02/LOT-03 per M4B.

## D2 — Catalogo e quantità

**Decisione approvata.** Il catalogo resta globale; Area e magazzino entrano solo nelle proiezioni di disponibilità e nei flussi operativi.

Ogni riga presenta un solo input principale `quantita`, etichettato con l'unità canonica del prodotto. Le dimensioni derivate vengono calcolate e storicizzate dal backend:

- unità indivisibili (`pz`, `cf` e altre esplicitamente configurate): intero positivo;
- `kg`, `lt` e unità esplicitamente frazionabili: decimale positivo entro precisione ammessa;
- fattore noto: peso/volume derivato, non secondo campo obbligatorio;
- fattore mancante: si raccoglie il dato aggiuntivo solo se semanticamente distinto e richiesto dal processo.

M2 introduce la proprietà esplicita di catalogo `quantitaFrazionabile`, con default `false` per `pz`, `cf` e `conf` e `true` per `kg`, `l` e `lt`, applicata con validazione backend comune. Il valore esplicito prevale sempre sull'unità dopo la creazione. Il valore usato dall'operazione e il fattore vengono copiati sulle righe/movimenti per conservare la semantica storica.

**Legacy.** Una query di preflight elenca prodotti indivisibili con frazioni. Queste righe non sono arrotondate: vengono marcate come anomalia, continuano a essere leggibili e richiedono una scelta esplicita di riclassificazione, rettifica o mantenimento legacy.

**Stato.** Implementazione verificata automaticamente e validata manualmente in M2 (`OK-M2/OK-MAN-M2`): default, override, helper fixed-point, flussi ordinari, diagnostica legacy e rettifica amministrativa sono coperti. Nessun dato storico viene arrotondato o corretto.

## D3 — Pratica di carico e integrazioni

**Decisione approvata.** Separare l'identità persistente della pratica dall'identità di ogni contabilizzazione incrementale immutabile.

- `carico_pratica`: testata persistente, versione ottimistica, stato `bozza`, `aperta`, `chiusa`, `annullata`; descrizione obbligatoria.
- `carico_riga`: ID stabile; modificabile finché non contabilizzata; porta prodotto, dettaglio fisico proposto, quantità e origine.
- `carico_integrazione`: evento immutabile di registrazione con idempotency key, request hash, attore e data.
- `carico_integrazione_riga`: collega l'integrazione alle sole righe/quote nuove contabilizzate.

`bozza` non produce lotti/movimenti. Il primo comando Registra porta la pratica ad `aperta` e contabilizza le righe selezionate. Aggiunte successive creano una nuova integrazione. La chiusura impedisce ulteriori aggiunte ordinarie; la riapertura è motivata e auditata.

Esempio vincolante: riga A da 80 contabilizzata nell'integrazione 1 + nuova riga/append da 20 nell'integrazione 2 = stock 100. Il retry dell'integrazione 2 restituisce lo stesso esito; non rilegge e contabilizza tutte le righe della pratica.

**Correzioni.** Una riga contabilizzata non viene riscritta. Il comando di correzione crea rettifica/storno collegato; prima controlla quantità residua, prenotata e già distribuita. Se la merce non è più disponibile, la correzione amministrativa non reintegra o sottrae stock in modo fittizio e richiede il percorso appropriato.

**Concorrenza.** Idempotency key univoca per comando, hash semantico, lock transazionale sulla chiave e versione della pratica. Stessa chiave+stesso payload = replay; stessa chiave+payload diverso = 409; versione superata = 409 con ricarica.

**Riutilizzo.** Estendere `createWarehouseLoad`, advisory lock, hash, `InventoryDecimal`, lineage riga/lotto/movimento e transazioni esistenti.

**Stato.** Requisito approvato in M0, implementato e validato in M3A: `carico_pratiche` conserva testata, stato e versione; `carico_pratica_righe` conserva il lavoro; `carico_integrazioni` e `carico_integrazione_righe` collegano in modo immutabile le righe al solo motore contabile `carichi_magazzino`. Test automatici e dry run reale Floriano sono superati (`OK-M3A/OK-MAN-M3A`); le sole prove fisiche fotocamera e tablet restano `NE-MAN-CAMERA` e `NE-MAN-TABLET`, non bloccanti per M3A.

### Import AGEA/FSE+

L'import confluisce nella stessa pratica ma conserva un sottodominio di staging:

1. acquisizione file e fingerprint crittografico;
2. parsing XLSX/XLS/CSV con formato realmente verificato;
3. staging immutabile delle righe originali;
4. classificazione di carichi nuovi, riferimenti, eventi già noti/coperti e contenuti modificati;
5. mapping autorizzato verso prodotti esistenti;
6. correzioni e ricalcolo versionati;
7. aggiunta selettiva alla pratica senza stock e successiva contabilizzazione attraverso il comando M3A `Registra`.

La sorgente esterna è distinta dal magazzino. L'identità semantica versionata usa sorgente, Fondo, prodotto esterno, documento/data, lotto, natura e mittente/destinatario; quantità, saldo finale, ordine del file, mapping interno e magazzino non trasformano lo stesso evento in un evento nuovo. Il fingerprint SHA-256 governa il replay dello stesso file, mentre claim attive univoche e idempotency key proteggono la presa in carico fra sessioni, pratiche e magazzini. Un contenuto diverso sulla stessa identità resta da riconciliare e non genera un delta automatico.

Il saldo iniziale è una modalità amministrativa della stessa procedura: richiede Registro e Giacenze coerenti per Fondo/Prodotto/Lotto e data di taglio, crea una pratica riservata `SALDO_INIZIALE`, non modifica lo stock prima di `Registra` e attiva la copertura storica nella stessa transazione della contabilizzazione integrale. Un secondo saldo o un saldo su magazzino con storia inventariale è bloccato. Le giacenze successive sono confronto, non incremento o overwrite automatico.

Il writer AGEA legacy resta consultabile ma viene bloccato sul magazzino già adottato da una sessione M3B, così non costituisce un secondo percorso di contabilizzazione. Le righe legacy applicate riconoscibili partecipano alla classificazione prudente; i casi non ricostruibili restano da verificare senza backfill.

**Stato.** Implementazione e test automatici M3B superati (`OK-M3B`): parser XLSX/XLS binario/CSV, staging e revisioni persistenti, mapping per sorgente, claim, import parziale riprendibile, documenti esterni per riga e saldo iniziale atomico sono verificati. T01 e T25 sono stati eseguiti sui due Excel originali, con saldo esatto di 1.177 pezzi dalle sette righe Giacenze e nessuna contabilizzazione delle 24.216 entrate storiche. La prova Playwright copre desktop e viewport tablet; fotocamera e tablet fisici restano rispettivamente `NE-MAN-CAMERA` e `NE-MAN-TABLET`. Lo stato automatico non equivale a validazione umana.

## D4 — Richiesta, documento e consegna

**Decisione approvata.** Introdurre una `richiesta_magazzino` autonoma, rappresentabile con intestatario e note ma senza righe prodotto. Non riutilizzare una bolla o un intervento materiale incompleto come richiesta.

Cardinalità approvata:

- una sorgente materiale di Centro/pianificazione/intervento ha `0..1` richiesta attiva, protetta da chiave sorgente univoca;
- ogni richiesta ha esattamente un destinatario (`beneficiario`, `ente`, `magazzino`) e una sola Area; il Centro richiedente è obbligatorio quando la sorgente è il Centro di Ascolto;
- una richiesta ha `0..1` documento operativo attivo e `0..1` pianificazione/consegna attiva; documento e pianificazione restano entità diverse e collegate alla stessa richiesta;
- ogni documento operativo e ogni pianificazione/consegna appartengono a `0..1` richiesta;
- in assenza di consegna parziale, una richiesta non produce più documenti attivi concorrenti per suddividerne le quantità;
- documenti e pianificazioni annullati non vengono cancellati o riutilizzati: la richiesta può quindi avere `0..n` collegamenti storici, ma al massimo uno attivo per tipo;
- eventuali casi legacy con più documenti vengono segnalati e preservati, non deduplicati o riclassificati automaticamente;
- i punti d'ingresso Centro, pianificazione e intervento usano la stessa chiave di origine e ritornano la richiesta attiva esistente al retry.

Campi minimi: destinatario tipizzato, beneficiario/ente/magazzino FK coerente, Area, Centro richiedente quando pertinente, data richiesta, termine preparazione/consegna, modalità, note operative minimizzate, sorgente, stato, versione, creatore. Nessuna copia dell'intero fascicolo sociale.

**Perché.** La coda corrente basata su bolla richiede prodotti, mentre `interventi_materiali` richiede almeno descrizione/unità/quantità. Nessuna delle due rappresenta fedelmente “serve materiale descritto nelle note”.

**Stato.** Entità e cardinalità attive approvate in M0; non implementate e non testate. Realizzazione e prove sono demandate a M5A e influenzano M4A.

### Stati e transizioni proposte

Gli stati della tabella descrivono l'orchestrazione della **richiesta**. Non rinominano automaticamente gli stati oggi presenti su `bolle`, `consegne` o `trasferimenti`: la corrispondenza tra gli aggregati dovrà essere definita in M4/M5 con transizioni atomiche e compatibilità esplicita.

Gli stati interni `in_trasporto` e `rientro_atteso` sono approvati. L'interfaccia dovrà esporli attraverso azioni operative semplici e comprensibili, senza obbligare il volontario a conoscere la macchina a stati interna.

| Da                                     | Comando → A                                         | Permesso/attore              | Prerequisiti ed effetto quantità                                                  | Documento/audit                        | Retry/conflitto                                            |
| -------------------------------------- | --------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------- |
| —                                      | Crea richiesta → `richiesta`                        | operatore Centro autorizzato | destinatario e Area validi; nessun effetto stock                                  | collega sorgente; evento creazione     | chiave sorgente restituisce esistente; payload diverso 409 |
| `richiesta`                            | Prendi in carico → `in_preparazione`                | magazziniere Area/magazzino  | seleziona magazzino; ancora nessuna quantità                                      | autore distinto dal richiedente        | versione ottimistica                                       |
| `in_preparazione`                      | Assegna righe → `in_preparazione`                   | magazziniere                 | ogni assegnazione crea prenotazioni atomiche per dettagli fisici; non scarica     | documento bozza e evento correlato     | idempotency per assegnazione; lock lotti                   |
| `in_preparazione`                      | Segna pronta → `pronta`                             | magazziniere                 | tutte le righe assegnate e prenotate; nessun residuo da reperire                  | documento congelato/versionato         | replay no-op; conflitto 409                                |
| `pronta`                               | Affida al trasporto → `in_trasporto`                | logistica/magazzino          | prenotazioni consumate nella posizione “affidata”; non disponibile sugli scaffali | trasportatore separato dall'attore     | un solo evento di affidamento                              |
| `pronta`                               | Consegna ritiro in sede → `consegnata`              | operatore consegna           | servizio comune effettua una sola distribuzione/scarico                           | bolla e pianificazione coerenti; audit | source operation unique; replay ritorna esito              |
| `in_trasporto`                         | Conferma consegna → `consegnata`                    | operatore consegna           | una sola distribuzione finale; merce esce da “affidata”                           | prova/esito senza PII eccedente        | lock documento; replay idempotente                         |
| `richiesta`/`in_preparazione`/`pronta` | Annulla → `annullata`                               | permesso cancel              | motivo obbligatorio; rilascia prenotazioni, nessun reintegro se non uscita        | storia e attività sociali restano      | replay no-op, payload incompatibile 409                    |
| `in_trasporto`                         | Mancata consegna → `rientro_atteso`                 | logistica                    | non reintegra scaffale; merce resta affidata                                      | motivo e custode correnti              | evento unico                                               |
| `rientro_atteso`                       | Registra rientro → `annullata` o nuova preparazione | magazziniere ricevente       | verifica fisica e reintegro/storno esplicito per dettaglio                        | documento di rientro e differenze      | lock quantità; retry idempotente                           |

Non è prevista consegna parziale. Se una parte manca, la richiesta resta in preparazione oppure viene annullata/riformulata tramite un nuovo evento; non si inventa una semantica parziale.

Responsabilità e momenti contabili:

- il Centro crea la richiesta e fornisce solo le note operative necessarie; non sceglie prodotti o lotti per rendere valida la richiesta;
- il Magazzino prende in carico, seleziona deposito, prodotti e dettagli fisici e crea le prenotazioni durante l'assegnazione;
- “pronta” conferma la completezza della preparazione, ma non scarica la merce;
- l'affidamento al trasporto toglie la merce dalla disponibilità di scaffale e ne registra la custodia, senza fingere la consegna finale;
- lo scarico/distribuzione finale avviene una sola volta alla conferma della consegna o del ritiro fisico, tramite lo stesso servizio da entrambi i menu;
- prima dell'uscita fisica, l'annullamento motivato libera le prenotazioni; dopo l'affidamento, la mancata consegna porta a `rientro_atteso` e non reintegra quantità;
- solo il Magazzino ricevente registra il rientro fisico e il relativo reintegro/rettifica; l'annullamento amministrativo da solo non modifica lo scaffale;
- Centro e Magazzino possono esporre i comandi di esito agli utenti autorizzati, ma l'attore registrato è sempre chi invia il comando autenticato, distinto dal trasportatore/incaricato.

### Destinatari e trasferimenti

Il documento comune usa un discriminatore e FK esclusive:

- `beneficiario`: distribuzione finale, può collegarsi a richiesta/consegna/intervento;
- `ente`: consegna esterna, distinta contabilmente dalla distribuzione a persona;
- `magazzino`: trasferimento interno, mai beneficiario fittizio.

L'unificazione è di servizio e interfaccia, non una fusione forzata di tabelle. L'attuale `trasferimenti` può restare aggregate root specializzato dietro un adattatore comune. Partenza crea uscita/in-transito; ricezione crea entrata collegata al movimento origine; differenze producono eventi espliciti. Nessuna disponibilità al deposito destino prima della ricezione.

**Stato.** È approvato il limite di un documento operativo attivo per richiesta. La forma esatta del documento/adattatore tipizzato e dei destinatari resta dettaglio progettuale di M4A/M4B; non è implementata né testata.

## D5 — Giacenze, Area e autorizzazioni

Ambito effettivo:

```text
magazzini_effettivi = magazzini_dell_area_selezionata
                      ∩ magazzini_visibili_da_RBAC/Centro/Area_utente
```

- Utente con una sola Area: preselezione obbligatoria.
- Utente con più Aree: nessuna query quantitativa finché non sceglie.
- Area scelta e nessun deposito: aggregato dei soli depositi effettivi dell'Area.
- Deposito scelto: il backend verifica appartenenza all'Area e autorizzazione; incongruenza = 400/403, non insieme vuoto ambiguo.
- Cambio Area: cancellazione del deposito incompatibile, query key comprensiva di Area+deposito, abort/invalidazione richieste precedenti e nessun rendering di cache del vecchio ambito.
- Tabella, KPI, disponibilità incorporate ed export usano la stessa risposta/chiave di ambito.

Definizioni non sovrapposte:

| Valore                    | Definizione                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| presente fisico           | residuo nei dettagli collocati sugli scaffali del deposito; include materiale non distribuibile |
| non distribuibile         | sottoinsieme del presente escluso da distribuzione (scaduto, bloccato o altra policy)           |
| distribuibile             | presente fisico − non distribuibile                                                             |
| prenotato                 | sottoinsieme del distribuibile riservato a richieste/documenti attivi                           |
| disponibile               | `max(0, distribuibile − prenotato)`                                                             |
| affidato al trasporto     | fuori dallo scaffale e fuori dal disponibile, ma non ancora consegnato; non è prenotato         |
| trasferimento in transito | fuori dall'origine e non ancora presente al destino; distinto dall'affidato per consegna finale |

Il “richiesto” è una domanda e non entra nella formula della disponibilità. Un riepilogo può calcolare `da_reperire = max(0, richiesto − già_assegnato)`, ma non deve confrontare di nuovo tutto il richiesto con uno stock dal quale le stesse assegnazioni sono già state sottratte.

Aggregazione esclusivamente per `prodottoId + unitaMisuraCanonica`; kg, litri, pezzi e confezioni non si sommano fra loro. I fattori servono a colonne derivate, non a una fusione implicita.

**Scorte minime — decisione approvata.** Sul singolo magazzino M1B mantiene la semantica esistente della scorta minima. Nell'aggregato di Area mostra le quantità aggregate, ma non dichiara l'intera Area sotto o sopra scorta usando `max(prodotti.scortaMinima)` o un'altra soglia arbitraria; le soglie non vengono sommate né moltiplicate. Se utile, può mostrare un indicatore derivato come “N magazzini sotto scorta”, calcolato sui singoli magazzini accessibili.

Un'eventuale soglia esplicita di Area o una policy prodotto×magazzino è una decisione strutturale demandata a M2.

**Stato.** Comportamento M1B approvato in M0; non implementato e non testato. L'eventuale modello strutturale M2 non è definito in M0.

## D6 — Contratto audit comune

**Decisione approvata.** Aggiungere in M1C un registro append-only `audit_eventi` e un helper transazionale comune, riutilizzando i registri verticali come proiezioni/collegamenti invece di estenderli impropriamente.

L'attore è ricavato esclusivamente da `req.user`/sessione autenticata nel backend. Un eventuale `operatoreId` ricevuto dal client viene escluso dal contratto o ignorato/rifiutato; può esistere un campo separato per incaricato/trasportatore, che non modifica l'autore dell'evento. L'`operatoreId` aggiornabile di una testata può continuare a indicare l'ultimo operatore per compatibilità, ma non sostituisce mai la sequenza append-only degli autori.

Campi minimi proposti:

- ID evento e `correlationId` del comando;
- tipo attore `utente|sistema`, `actorUserId` nullable, codice/matricola snapshot e utente iniziatore per processi automatici;
- comando/azione, entità e ID, documento e ID, evento precedente/causale quando presenti;
- Area, Centro e magazzino snapshot pertinenti;
- timestamp registrazione e data operativa distinta;
- motivo obbligatorio per annullamenti/rettifiche;
- differenze `precedente/nuovo` limitate ai campi rilevanti e metadati sanitizzati;
- idempotency/operation key per impedire duplicazioni.

L'evento e la modifica inventariale devono essere nella stessa transazione. Un fallimento dell'audit fa rollback del comando quando l'evento è obbligatorio. `system_logs`, oggi best-effort, resta adatto a login/sicurezza tecnica ma non certifica una movimentazione. `audit_configurazioni`, storico interventi e registri FSE/volontari restano fonti verticali collegate.

Il movimento inventariale riceve `auditEventoId`/correlationId; più movimenti FEFO di un solo comando condividono la correlazione. Il codice autore è storicizzato per sopravvivere a disattivazione o successivo cambio matricola; il FK non deve causare cancellazione della storia.

Per record legacy senza attore si conserva null e si mostra “Non disponibile — dato precedente”. Vietato valorizzare con l'utente che esegue la migrazione.

Campi vietati: password, hash/token/cookie, segreti SMTP, intere note sociali, documenti o payload non minimizzati. Si estende la sanitizzazione di `systemLog.ts` con allowlist per tipo evento.

Copertura progressiva:

- M1C: infrastruttura, eventi comuni e percorsi fondamentali inventario/documenti;
- M2: catalogo, lotti, rettifiche e migrazione;
- M3: bozze, integrazioni e import;
- M4: documenti, prenotazioni, consegne, trasferimenti e rientri;
- M5: richieste, preparazione e sincronizzazioni sociali;
- M6: censimento finale di tutte le mutazioni e test di assenza segreti.

**Stato.** Requisito approvato in M0. Il candidato M1C introduce il registro e l'helper comune, usa FK `ON DELETE SET NULL` soltanto per attore/iniziatore e conserva Area, Centro e Magazzino come ID snapshot senza FK live. Non espone endpoint o menu audit. La fase `##test M1C` automatica è superata (`OK-M1C/NE-MAN`); la validazione manuale/umana non è ancora eseguita. `previousEventId` rappresenta l'ultimo evento committato osservabile della stessa entità, non una catena strettamente serializzata: comandi concorrenti possono condividere il predecessore senza alterare eventi o correlazioni.

## D7 — Interfaccia e compatibilità

Menu finale Magazzino, nell'ordine da validare visivamente:

1. Catalogo prodotti
2. Carico Merce
3. Scarico Bolle
4. Scarichi Manuali
5. Giacenze
6. Preparazione Consegne
7. Lista movimenti

“Lotti” non è voce primaria: gestione in Carico e consultazione/dettaglio in Giacenze. Trasferimenti confluisce nel percorso documentale mantenendo URL/redirect e permessi durante la transizione.

Percorso del volontario:

- sceglie Area, poi deposito oppure “tutti i depositi dell'Area”;
- nel carico inserisce testata una volta, sceglie/scansiona prodotti, indica una quantità per riga e salva bozza o registra;
- dal Centro crea una richiesta con note, senza scegliere prodotti/lotti;
- il magazziniere apre la richiesta, assegna prodotti e lotti disponibili, poi la marca pronta;
- la consegna viene confermata una volta dallo stesso servizio, indipendentemente dal menu di ingresso.

La complessità degli stati interni resta nascosta dietro queste azioni operative semplici; i nomi tecnici possono comparire nei dettagli diagnostici o amministrativi, non come prerequisito per completare il lavoro ordinario.

Semantica controlli:

- selezione persistente: `aria-selected`/`aria-pressed` appropriato e indicatore non solo cromatico;
- azione: feedback press/pending/esito/errore, disabilitazione durante mutation non idempotente;
- indisponibile: stato disabled e motivazione accessibile;
- barcode: icona download e testo “Scarica codici a barre”, distinto dalla fotocamera;
- password: pulsante `type=button`, valore invariato, nascosta inizialmente e label accessibile;
- Area/Magazzino: componente condiviso con query key e reset coerenti.

Componenti candidati da riutilizzare/estendere: `Button`, `Tabs`, `Switch`, `ExportButtons`, `BarcodeScannerButton`, `useAuth`, `useListAreeOperative`, `useListMagazzini`, query client comune e namespace i18n. Nessuna voce nuova compare prima che route, API, permesso e test siano operativi.

**Stato.** È approvata la semplificazione degli stati in azioni operative. Ordine del menu e percorsi restano da validare visivamente nelle rispettive milestone; le correzioni UX indipendenti appartengono a M1A, mentre la ristrutturazione del menu attende M4/M6. Nulla è implementato o testato dalla chiusura M0.

## Chiusura delle decisioni M0

Le decisioni umane richieste da M0 sono state registrate come approvate. La precedente proposta di usare `max(prodotti.scortaMinima)` per l'Area è respinta e sostituita dalla regola D5; il codice lotto fisico/produttore è separato semanticamente dal lotto logico e dalla generica partecipazione del prodotto alla gestione lotti.

M0 è chiuso sul piano decisionale. Tutte le righe marcate “non implementato” o “non testato” restano lavoro delle rispettive milestone e non possono essere considerate soddisfatte dalla sola approvazione documentale.

## D8 — Facciata documentale M4A e destinatario Ente

**Decisione M4A definitiva.** L'unificazione è applicativa e di interfaccia, non una
fusione distruttiva delle tabelle. `bolle` resta autorevole per Beneficiario ed
Ente; `trasferimenti` resta autorevole per Altro Magazzino. L'identità comune
include sempre tipo aggregato e ID.

L'Ente usa un'anagrafica minima propria, non un fornitore reinterpretato. I
riferimenti Beneficiario/Ente sono esclusivi; il tipo non cambia dopo la
creazione.

### D8.1 — Segno e semantica di `CONSEGNA_ENTE`

L'uscita Ente usa `CONSEGNA_ENTE` e non produce fatti sociali, persone/pacchi
assistiti o pianificazioni personali. È un'uscita fisica distinta da
`DISTRIBUZIONE_FINALE`:

- le quantità del ledger restano positive e il segno contabile derivato è
  `-1` in ogni proiezione TypeScript/SQL, report ed export pertinente;
- bozza e conferma non riducono il fisico; la consegna lo riduce una sola
  volta;
- fondo, provenienza, lotto, riga e lineage restano quelli reali;
- non vengono attribuite persone assistite, nuclei o pacchi e non viene
  ampliata l'ammissibilità FSE+/AGEA.

Uno storno ammesso usa un evento compensativo collegato; non cambia il segno
storico del movimento originario e non salva quantità negative per compensare
una proiezione errata.

### D8.2 — Permessi e moduli per tipo documentale

La facciata comune applica un'unione di rami autorizzati:

- Bolle e relativi destinatari richiedono i moduli, permessi e scope propri;
- Trasferimenti richiedono i moduli, permessi e scope propri;
- Mensa mantiene permessi e regole verticali distinti;
- lettura, creazione/modifica, partenza, ricezione, annullamento e storno
  restano capacità separate.

Lista, conteggio, ricerca ed export rimuovono i rami non autorizzati prima
della paginazione. Dettaglio, PDF, replay e comandi rivalidano tipo e scope. Il
permesso di un ramo non concede dati o azioni dell'altro e un gate Bolle non
può bloccare il percorso legittimo di un utente Trasferimenti.

### D8.3 — Protocollo dei comandi e replay

Ogni comando mutante M4A segue lo stesso protocollo:

1. `idempotencyKey` identifica l'intenzione e l'hash copre il payload
   semantico normalizzato;
2. una mutazione di aggregato esistente include la versione attesa; una
   creazione non inventa una versione antecedente;
3. il backend acquisisce i lock nell'ordine definito, rilegge stato e versione
   autorevoli e verifica la transizione;
4. effetto di dominio, nuova versione, audit obbligatorio e ricevuta del
   comando sono committati nella stessa transazione;
5. prima di restituire anche un replay già registrato vengono rivalidati
   sessione, permessi, moduli e scope correnti.

Stessa chiave e stesso payload restituiscono lo stesso esito senza duplicare
l'effetto; stessa chiave e hash diverso producono conflitto; una nuova
intenzione con versione superata produce conflitto. Dopo una risposta incerta
il frontend riusa esattamente chiave, payload e versione originari. Una nuova
chiave viene generata soltanto per una nuova intenzione esplicita.

Route comune, adapter legacy e consumer verticali convergono sul medesimo
servizio; non sono ammesse transazioni o ricevute parallele che rendano
separabili documento, inventario, audit e replay.

### D8.4 — Snapshot Ente autorevole e fallback legacy

Alla conferma il backend congela dall'anagrafica autorevole denominazione,
indirizzo e contatti previsti. Quando lo snapshot è marcato come congelato,
dettaglio e PDF usano quei valori anche se l'Ente viene modificato o
disattivato; un campo congelato nullo resta nullo e non viene riempito con un
nuovo dato live.

Il legacy senza snapshot usa soltanto un fallback live esplicito e
riconoscibile. Il fallback non viene descritto come fotografia storica, non
modifica il record durante la lettura e non giustifica un backfill
indiscriminato. La disattivazione preserva storico e ristampe autorizzate, ma
impedisce nuove operazioni vietate.

### D8.5 — Annullamento ordinario e storno amministrativo

La normale azione Annulla è motivata e precedente all'uscita fisica. Nessun
annullamento ordinario post-uscita reintegra merce: prima dell'uscita libera
gli impegni senza creare un falso movimento fisico.

Lo storno amministrativo è un comando separato e nominato esplicitamente,
riservato al permesso `bolle.reverse.admin`. Richiede motivo, righe esatte,
versione, idempotenza, conferma forte e audit; produce movimenti compensativi
collegati senza cancellare o riscrivere la storia. Non è la scorciatoia per una
mancata consegna e non simula il rientro. Affidamento, mancata consegna,
`rientro_atteso` e ricezione fisica del rientro restano decisione esecutiva
M4B.

### D8.6 — Identità URL, lista ed export comuni

L'identità canonica è composta: `bolla:<id>` e `trasferimento:<id>` sono
documenti diversi anche quando condividono lo stesso numero interno. L'URL usa
il parametro `documento=tipo:id`; tipo e ID partecipano anche a stato UI,
query key, invalidazioni, mutazioni e PDF. Gli URL legacy realmente supportati
vengono adattati alla forma canonica preservando i filtri, senza concedere
accesso aggiuntivo. L'interfaccia mantiene un solo dettaglio aperto.

Lista, totale ed export usano lo stesso insieme misto server-side, già
filtrato per autorizzazioni, e gli stessi criteri: tipo aggregato e
destinatario, stato, date, Area, Magazzino, Centro quando pertinente, ricerca
e ordinamento. L'ordine usa discriminatore e ID come spareggio stabile;
l'export copre l'intero insieme filtrato, non soltanto la pagina visibile. Un
cambio di scope non può renderizzare una risposta tardiva e conserva il draft
oppure richiede conferma prima di scartarlo.

**Stato.** Le precisazioni D8 sono requisiti definitivi M4A. Il working tree
contiene un'implementazione candidata e prove mirate, ma la revisione statica
resta NO-GO finché i correttivi post-review e un nuovo `##test M4A` separato
non sono completati. Non risultano quindi ancora acquisiti GO formale,
validazione umana o chiusura M4A.

## M4B.1 — Prenotazione comune e «Pronto» reale

La specifica M4B approvata resta il contratto architetturale; M4B.1 ne
implementa solo la prima sezione. Una prenotazione appartiene **o** a una
Bolla **o** a un Trasferimento, con coppia testata/riga completa e coerente
protetta nel database. Solo lo stato `attiva` riduce la disponibilità reale.
Le prenotazioni Bolla legacy rimangono attribuite alla Bolla, senza conversione
retroattiva. Lotto esplicito e selezione FEFO senza lotto usano lo stesso
servizio transazionale e la stessa contabilità a precisione fissa.

Il Trasferimento nasce `richiesto` senza impegnare merce. «Segna pronto»
prenota atomicamente tutte le righe e lo porta a `preparato`, mostrato come
**Pronto**; il residuo fisico non cambia. Da Pronto non si modificano righe o
metadati e non è previsto «Riapri». «Avvia» è consentito solo da Pronto e
converte le prenotazioni esatte in movimenti di uscita, senza rifare FEFO.
Un annullamento motivato da `richiesto` o `preparato` rilascia gli impegni,
non genera movimenti e non è consentito dopo la partenza.

Preparazione, partenza, ricezione e annullamento sono capacità distinte;
Mensa mantiene la propria policy e non acquisisce automaticamente la facoltà
di spedizione del Magazzino origine. Audit, versione e ricevuta idempotente
sono atomici con ogni transizione. Trasferimenti già `in_transito` prima della
migrazione rimangono ricevibili. Affidamento Bolla, rientro fisico e stati
M4B.2 **non** fanno parte di questo incremento.

Queste sono decisioni/requisiti; l'implementazione M4B.1 nel working tree è
ancora `DEV-M4B.1/NE-TEST/NE-MAN`, non validazione formale o umana.

## M4B.2 — decisione approvata sul rientro fisico

La decisione successiva di Floriano chiude l'ambiguità della classificazione
`altro`: **non è ammessa**. Ogni quantità realmente uscita deve essere
riconciliata esattamente come idonea, deteriorata, scaduta, mancante o rubata.
Idonea/deteriorata/scaduta sono merce fisicamente rientrata; mancante/rubata
non lo sono. Le note restano descrittive, mai sostitutive della classe.

Il rientro è sempre e soltanto nel Magazzino origine del documento, senza
scelta dell'operatore, cambio Area o trasferimento implicito. Il lotto fisico
si ricostruisce dal movimento reale di uscita, non dalla sola riga documento.
L'idonea reintegra quel lotto; deteriorata e scaduta lo reintegrano e, nella
stessa transazione, sono scaricate con il motore Scarichi esistente. Mancante
e rubata generano documenti/eventi di anomalia a effetto fisico zero: nessun
secondo scarico. Una riconciliazione completa chiude Bolla o Trasferimento in
`rientrato`, stato terminale; un nuovo tentativo richiede un nuovo documento.

Questa è una **decisione approvata**. Il codice M4B.2 nel working tree è
`DEV-M4B.2/NE-TEST/NE-MAN`: le prove di sviluppo non equivalgono al separato
`##test M4` né alla validazione manuale.

### Evidenza formale successiva

Il successivo `##test M4` ha verificato automaticamente la decisione nel
ledger, nel DB PostgreSQL, nelle API, nella UI, nei PDF e nel reporting;
vedere `ESITI_TEST_M4.md`. La classificazione `altro` resta assente, il
rientro usa sempre origine e partita realmente uscita, e l'evento `esito`
non diventa un secondo scarico. Questo è stato di **requisito approvato e
test automatico**, non una nuova decisione né una validazione manuale:
`NE-MAN` permane per M4B/M4.

## UX-CARICO-LOTTI — Fase A (contratto tecnico di sviluppo)

La nuova navigazione di Carico Merce usa tre tab con deep-link
`carichi|raccolte|lotti`. `lotto_logico` resta la Raccolta/Attività dell'Area
e `lotti` resta la partita fisica reale: la UI non introduce un'anagrafica
parallela né crea stock dalla tabella dei lotti. Il dialog di creazione della
Raccolta è condiviso tra Carichi e Raccolte; le azioni di lifecycle chiamano
solo le API già esistenti e `Generale` rimane immutabile.

La lista `/lotti` è estesa in modo additivo: `includeEsauriti` è opt-in,
mentre il default conserva il filtro sul residuo positivo. La risposta
consultiva espone Area, prodotto, Raccolta, prenotato/disponibile e il
lineage delle registrazioni di carico. Provenienze e documenti multipli
sono mostrati come tali: la quantità residua **non** viene attribuita
arbitrariamente a un'origine. I dati legacy privi di collegamento sono
indicati come non disponibili, senza retrodatazione.

Il fornitore è un riferimento distinto da `origineCarico`; il carico manuale
usa `fornitoreId`, numero e data DDT già presenti nella pratica e continua
a contabilizzare tramite il servizio inventariale autorevole. Scanner e
suggerimenti precompilano soltanto la bozza della riga; nessun saldo è
modificato prima della conferma. Il vecchio `/lotti` è un redirect
compatibile; la rettifica inventariale esistente resta accessibile nella
vista dei lotti fisici con il permesso preesistente, mentre il vecchio
writer diretto di un nuovo lotto non è più esposto.

La Fase A aveva stato `DEV-UX-CARICO-LOTTI/NE-TEST/NE-MAN`; la successiva
validazione formale è registrata in `ESITI_TEST_UX_CARICO_LOTTI.md` come
`OK-TEST-UX-CARICO-LOTTI/OK-MAN-UX-CARICO-LOTTI`. Il PASS manuale è quello
dichiarato da Floriano per questa UX, non una validazione dell'intera M4.
Restano `NE-MAN-CAMERA` e `NE-MAN-TABLET` per l'hardware fisico.

La conferma del carico considera **solo** righe persistite, complete e
selezionate: il salvataggio di una riga completa la seleziona, mentre una
bozza incompleta non selezionata non blocca il carico parziale. Una riga
selezionata modificata localmente blocca la conferma finché non viene
salvata; i draft delle altre righe rimangono intatti. La richiesta del
codice lotto dipende esclusivamente da `lottoFisicoObbligatorio`: se falso
il lotto è facoltativo e usa l'aspetto normale; se vero è obbligatorio ed
evidenziato in blu con «Lotto richiesto» in Catalogo, selettore prodotto
e riga Carico. Non esistono eccezioni per provenienza, fornitore o FSE+.

Nessuna migrazione è stata introdotta; Docker persistente e `main` sono
rimasti invariati durante `##test`.
