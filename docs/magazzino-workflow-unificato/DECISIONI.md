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

Il dettaglio fisico conserva un proprio ID e non viene fuso automaticamente con righe aventi gli stessi valori. Un eventuale consolidamento è ammesso solo da un servizio che confronti almeno prodotto, magazzino, fondo, provenienza/fornitore, codice lotto fisico normalizzato, scadenza effettiva, unità e fattore, mantenendo comunque il lineage dei carichi.

Il lotto logico contiene codice, descrizione, Area operativa, date indicative, note, stato e autori. La sua data termine/scadenza è organizzativa; il FEFO usa esclusivamente la scadenza effettiva del dettaglio fisico.

**Perché.** Il modello attuale è già una buona fonte fisica delle giacenze. Trasformarlo in contenitore multiprodotto romperebbe i riferimenti da righe, prenotazioni, movimenti, trasferimenti e rendicontazione.

**Alternativa scartata.** Rendere l'attuale `lotti` multiprodotto e spostare tutte le quantità altrove: migrazione più invasiva e rischio alto di perdita del lineage.

**Impatto.** Nuova relazione e migrazione conservativa in M2; adeguamento OpenAPI/client, carichi, viste giacenza e documenti successivi.

**Stato.** Requisito approvato in M0; non implementato e non testato. Schema, migrazione conservativa e prove sono demandati a M2 e condizionano M3–M4.

### Lotto logico “Generale”

**Decisione approvata.** Un solo lotto logico di sistema “Generale” per ogni Area operativa, stabile, sempre disponibile e non archiviabile. È un vero lotto logico operativo di default, non è una partita fisica, non crea merce e non deve essere globale fra aree.

- È preselezionato per un carico privo di attività specifica, ma resta visibile e confermato prima della registrazione.
- Il codice lotto fisico/produttore è nullable e non diventa obbligatorio per il solo fatto che il prodotto partecipa alla gestione lotti del Magazzino Solidale; `Generale` non sostituisce né inventa tale codice.
- In M2 verrà definito un requisito separato del prodotto per rendere obbligatorio il codice fisico/produttore quando la reale tracciabilità lo richiede. Il nome definitivo del campo sarà scelto in M2 e non è definito o implementato in M0.
- Anche senza codice lotto fisico viene creato un dettaglio distinto, perché quantità, magazzino, fondo, scadenza e lineage devono restare separati.
- I dati legacy non vengono assegnati retroattivamente a “Generale”: `lotto_logico_id` resta nullo con classificazione `legacy_non_ricostruibile` fino a una riconciliazione documentata.
- Un'Area legacy nulla non riceve automaticamente un “Generale”. Le nuove operazioni richiedono Area valida.

**Perché.** Un default globale attraverserebbe il confine territoriale e renderebbe ambigua la chiusura; un default per prodotto moltiplicherebbe contenitori privi di significato per il volontario.

**Stato.** Requisito approvato in M0; non implementato e non testato. La migrazione resta attività M2.

### Ciclo di vita

- `aperto`: riceve nuovi dettagli/carichi.
- `chiuso`: nessun nuovo carico ordinario; consultabile e riapribile con comando motivato/audit.
- `archiviato`: nascosto dai selettori ordinari ma sempre storico; solo se chiuso.
- `esaurito` è una condizione derivata, non uno stato scritto: somma residui a zero in tutti i magazzini e nessuna merce collegata in transito.
- “Mai caricato” è distinto: zero dettagli fisici, non “esaurito”.
- La riapertura non ricrea né modifica le partite esistenti.

Il lotto “Generale” non viene chiuso. Una raccolta ordinaria può essere chiusa anche con residuo, ma non viene dichiarata esaurita finché resta merce o transito.

## D2 — Catalogo e quantità

**Decisione approvata.** Il catalogo resta globale; Area e magazzino entrano solo nelle proiezioni di disponibilità e nei flussi operativi.

Ogni riga presenta un solo input principale `quantita`, etichettato con l'unità canonica del prodotto. Le dimensioni derivate vengono calcolate e storicizzate dal backend:

- unità indivisibili (`pz`, `cf` e altre esplicitamente configurate): intero positivo;
- `kg`, `lt` e unità esplicitamente frazionabili: decimale positivo entro precisione ammessa;
- fattore noto: peso/volume derivato, non secondo campo obbligatorio;
- fattore mancante: si raccoglie il dato aggiuntivo solo se semanticamente distinto e richiesto dal processo.

M2 introdurrà la proprietà esplicita di catalogo `quantitaFrazionabile`, con default `false` per `pz` e `cf` e `true` per kg/litri, applicata con vincolo backend. Il valore usato dall'operazione e il fattore vengono copiati sulle righe/movimenti per conservare la semantica storica.

**Legacy.** Una query di preflight elenca prodotti indivisibili con frazioni. Queste righe non sono arrotondate: vengono marcate come anomalia, continuano a essere leggibili e richiedono una scelta esplicita di riclassificazione, rettifica o mantenimento legacy.

**Stato.** Requisito approvato in M0; non implementato e non testato. Implementazione e bonifica non distruttiva sono demandate a M2 e ai contratti M3/M4.

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

**Stato.** Requisito approvato in M0; non implementato e non testato. Realizzazione e prove sono demandate a M3A.

### Import AGEA/FSE+

L'import confluisce nella stessa pratica ma conserva un sottodominio di staging:

1. acquisizione file e fingerprint crittografico;
2. parsing XLSX/XLS/CSV con formato realmente verificato;
3. staging immutabile delle righe originali;
4. classificazione `nuovo_ingresso`, `snapshot_registro`, `aggiornamento`, `solo_analisi`;
5. mapping autorizzato verso prodotti esistenti;
6. correzioni e ricalcolo versionati;
7. conferma che crea una o più integrazioni del carico.

La chiave antiduplicazione combina sorgente, fingerprint, identità del registro/periodo e chiavi esterne di riga. Ricaricare lo stesso file non incrementa lo stock. Un registro cumulativo aggiorna lo staging e contabilizza solo delta esplicitamente classificati come nuovi ingressi.

Stato attuale verificato: solo XLSX; staging, mapping, ricalcolo, versioni, transazione e replay sono riutilizzabili. XLS e CSV sono requisito non implementato.

**Stato/blocco.** Da validare; blocca M3B.

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
