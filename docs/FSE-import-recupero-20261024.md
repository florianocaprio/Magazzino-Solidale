# FSE+ — date, quantità e recupero della pratica

## Diagnosi del 24 ottobre 2026

L'ispezione di Hetzner è stata effettuata in sola lettura. Le due sessioni interessate risultavano annullate, con le associazioni dei prodotti conservate. Non risultavano claim di movimentazione né coperture iniziali FSE+; il magazzino interessato non aveva movimenti. Nessuna pratica produttiva è stata riattivata e nessuna quantità è stata caricata durante l'indagine.

I video e i dati salvati mostrano tre problemi distinti:

- Il Registro riportava il saldo al 20/10/2026, mentre le Giacenze avevano una data inserita manualmente diversa. Il controllo bloccava l'aggiunta alla pratica solo alla fine.
- Nei carichi del Registro mancava il fattore pezzi/kg-litri, pur essendo presenti entrambe le quantità. Questo produceva errori di compatibilità. La data del documento era disponibile, ma richiedeva una conferma esplicita in assenza della data di carico.
- Il riconoscimento di un file già acquisito rimandava a una sessione appartenente a un'altra pratica; l'interfaccia tentava di continuare nella pratica nuova. Il recupero e la correzione delle righe erano poco visibili.

## Correzione

- La data di riferimento identifica il giorno delle giacenze, non il giorno di caricamento del file. Quando omessa viene proposta quella del Registro. Una discordanza viene bloccata prima di salvare il file Giacenze.
- Una sessione di saldo ancora modificabile permette di correggere la data con motivazione, controllo di versione, autorizzazione aggiornata e audit. La data deve coincidere con quella del Registro, se disponibile. Le sessioni già prese in carico restano protette.
- Il fattore viene ricavato soltanto quando il file contiene entrambe le quantità positive. Il validatore verifica che riproduca pezzi e peso/volume; un fattore esplicito incoerente resta un errore. La dimensione viene conservata anche nella registrazione del saldo.
- Le righe del Registro si correggono in una finestra con etichette, valori originali visibili e motivazione. È possibile cambiare l'associazione del prodotto. Le sole righe che richiedono esclusivamente la conferma della data documento possono essere confermate insieme; ogni correzione resta salvata e tracciata separatamente.
- Un file già acquisito offre il collegamento alla pratica corretta. L'elenco Carico Merce mostra le importazioni da completare per i magazzini accessibili, indipendentemente dal filtro temporale delle pratiche. La finestra interna mostra le sessioni pertinenti alla pratica aperta.
- “Sospendi importazione” chiude la finestra conservando i dati salvati. Il caricamento del file, il mapping e l'aggiunta alla pratica non contabilizzano stock: serve la conferma del carico.
- La creazione del prodotto propone l’unità esplicita del file Giacenze (`kg` o `l`), modificabile; in assenza di unità esplicita propone `pz` solo se sono disponibili quantità in pezzi. Unità discordanti o sola colonna KgLt richiedono una scelta. Non si deduce l’unità dal nome. La correzione mostra l’unità del catalogo e permette di riprendere la quantità corrispondente, oppure cambiare prodotto associato, senza modificare automaticamente il catalogo.
- Giacenza iniziale e Nuovi carichi hanno una spiegazione distinta. Per riportare le disponibilità attuali dei due file originali serve Giacenza iniziale, non la registrazione di tutti i carichi storici.

## Impatto tecnico

Nessuna modifica allo schema del database e nessuna nuova migrazione. La cancellazione riutilizza le chiavi esterne già installate da `20260819_audit_magazzino_hardening.sql` e dalle migrazioni successive; se mancano le sei protezioni storiche di base, l’operazione viene bloccata.

Nuovo endpoint `PATCH /fse-importazioni/sessioni/{id}/data-riferimento`, descritto in OpenAPI. Esposto nel dettaglio della sessione e nel contratto anche `unitaMisuraPeso`, già conservato dal parser nel database. Client React e tipi Zod rigenerati con `pnpm --filter @workspace/api-spec run codegen`.

File applicativi: `fsePracticeImportService.ts`, nuovo `fseImportQuantity.ts`, `routes/fse-importazioni.ts`, `fse-import-practice-wizard.tsx`, nuovo `fse-pending-imports.tsx`, `pages/carico-merce.tsx`, traduzioni italiane `blocco07.ts` e proposta unità `fse-unit-suggestion.ts`. Test API, unitari e browser aggiornati nei rispettivi file FSE.

## Eliminazione protetta dei prodotti inutilizzati

Nel Catalogo è disponibile l’azione separata “Elimina definitivamente”, riservata a `magazzino.products.manage`. La finestra verifica prima i collegamenti e consente la conferma soltanto per un prodotto senza dipendenze. Il controllo viene ripetuto sul server nella stessa transazione della cancellazione, bloccando la riga del prodotto per serializzarla con nuovi utilizzi. L’audit conserva codice, nome, unità e stato precedenti.

Basta un lotto (anche esaurito), un movimento, una riga di documento o un’associazione d’importazione per impedire la cancellazione. Non vengono scollegati automaticamente prodotti dalle sessioni FSE. La disattivazione e la riattivazione esistenti restano disponibili; `DELETE /prodotti/{id}` continua a disattivare. I nuovi `GET` e `DELETE /prodotti/{id}/eliminazione` sono descritti in OpenAPI e generati nel client e nei tipi Zod.

File aggiuntivi coinvolti: `artifacts/api-server/src/routes/prodotti.ts`, nuovo `src/lib/prodottoRemoval.ts`, `artifacts/magazzino-solidale/src/pages/prodotti.tsx`, traduzioni `src/lib/i18n/namespaces/prodotti.ts`; test in `artifacts/api-server/tests/prodotti.test.ts`, `src/components/prodotti-m1a.test.tsx` e nello scenario browser FSE. Nessun prodotto reale viene eliminato dalle verifiche automatiche.

## Validazione

Le prove API e browser usano database Docker temporanei creati dal runner canonico; non usano il database della 8082 o quello produttivo. Gli originali Excel restano esterni al repository e vengono passati con `FSE_REGISTRY_ORIGINAL_PATH` e `FSE_STOCK_ORIGINAL_PATH`.

- `pnpm install --frozen-lockfile`: completato, lockfile invariato.
- `pnpm run typecheck`: superato.
- Build frontend e `build:budget`: superati; entry iniziale 394,9 KiB gzip entro il limite esistente.
- Test unitari frontend: 897 superati, compresi scelta unità kg/l, unità ambigue, payload di creazione e correzione nell’unità del catalogo.
- Browser: `node scripts/quality-gates-run.mjs browser fse-import-practice-m3b.spec.ts`: 12 superati, 23 esclusioni previste per viewport (i casi inventariali mutanti girano una volta su desktop). Compresi originali, ripresa, import parziale, risposta di rete interrotta, reimportazione senza duplicazione, unità letta dal file, cancellazione del prodotto inutilizzato e blocco di quello già associato a FSE.
- Gli originali producono 11 righe di giacenza e 3.244 pezzi; la registrazione completa e la successiva reimportazione sono state verificate nel browser.
- API: `node scripts/quality-gates-run.mjs api general`: 150 file superati, 1.623 test superati e 5 esclusioni previste. Comprende i 32 test di integrazione del servizio FSE, gli originali e i controlli di concorrenza/idempotenza. Sono inclusi anche eliminazione con audit, protezione del lotto esaurito, movimenti storici, permessi e carico concorrente. Il runner esegue il comando test API del workspace sul database temporaneo.

## Prova manuale sulla 8082

1. Per la giacenza iniziale usare un magazzino senza storia inventariale e selezionare i due file riferiti allo stesso giorno. Lasciare vuota la data: con gli originali del 20 ottobre deve comparire 20/10/2026.
2. Verificare le associazioni, sospendere, ricaricare la pagina e usare “Riprendi pratica” nell'elenco Carico Merce. La sessione deve conservare associazioni e righe.
3. Confermare la copertura storica, controllare il riepilogo e aggiungere alla pratica; verificare che le quantità entrino a magazzino solo dopo la conferma del carico.
4. Durante la creazione di un prodotto, verificare l’unità proposta dal file e la possibilità di cambiarla. In correzione la quantità deve riportare l’unità del prodotto associato.
5. Riprovare gli stessi file: non deve essere creato un secondo stock. Nella modalità Nuovi carichi verificare anche correzione di una riga e conferma delle date documento proposte.

6. Nel Catalogo creare un prodotto di prova senza utilizzi e usare “Elimina definitivamente”. Su un prodotto già caricato o associato a un import la conferma deve restare bloccata con una spiegazione.

Le pratiche annullate rimangono annullate. Un nuovo import può riutilizzare le associazioni della stessa sorgente. Rimangono attivi i controlli contro saldo iniziale su magazzini con storia, file incoerenti, duplicati e modifiche concorrenti. Nessun merge o deploy produttivo è incluso in questa verifica locale.

## Confronto delle sole Giacenze e ripartenza autorizzata

Il confronto delle Giacenze è distinto dalla registrazione di nuovi carichi. Un saldo corrente non permette di ricostruire i carichi intervenuti fra due esportazioni: possono esserci stati anche scarichi. Per registrare nuovi carichi resta necessario il Registro; per verificare l'allineamento basta il file Giacenze.

In Carico Merce, selezionare Area e un singolo Magazzino, poi **Verifica giacenze FSE+**. Il selettore Registro è disabilitato. Il file viene confrontato con le giacenze fisiche attuali dei fondi FSE+, Nazionale e Nazionale Cofinanziato del magazzino, usando le associazioni della sorgente selezionata. Non vengono creati sessioni, pratiche, prodotti, carichi o movimenti.

L'esito **Magazzino allineato**, in verde, richiede un file non vuoto, tutte le righe riconosciute, quantità coincidenti per prodotto/fondo/lotto e assenza di giacenze locali ulteriori. Vengono confrontate anche le scadenze fornite e la seconda dimensione fisica se presente. Conversioni mancanti, unità incompatibili, duplicati o righe non associate impediscono l'esito verde. Le differenze sono mostrate con quantità nel file e in magazzino, senza rettifiche automatiche. Il risultato indica il momento della verifica e viene azzerato cambiando file o sorgente.

Endpoint aggiuntivo `POST /fse-importazioni/confronta-giacenze`, con permesso importazione e verifica autorevole di ruolo, territorio, magazzino e sorgente. Il confronto usa una transazione con snapshot coerente. Nessuna modifica allo schema. OpenAPI e tipi client/Zod rigenerati con il comando canonico; il postprocessore Orval conserva il corpo binario del file.

File applicativi aggiuntivi: `src/lib/fseStockComparison.ts` e `src/routes/fse-importazioni.ts` nel server; `src/components/fse-stock-comparison.tsx` e `src/pages/carico-merce.tsx` nel frontend. Test dedicati `fse-stock-comparison.test.ts`, `fse-stock-comparison.test.tsx`; estesi i test API e browser `fse-import-practice-m3b` per ripetere il confronto dopo l'importazione dei due file originali.

### Pulizia produttiva del 24 ottobre, separata dal deploy

Dopo conferma esplicita dell'utente sono stati eliminati i soli 33 prodotti creati nei due tentativi annullati e le 56 associazioni FSE+ corrispondenti. Prima della transazione è stato creato un backup PostgreSQL completo, verificato con `pg_restore --list` e checksum SHA-256. La transazione ha ricontrollato tutte le chiavi esterne verso i prodotti, le evidenze di creazione e lo stato annullato delle due sessioni, bloccando i record interessati.

Nessun prodotto eliminato aveva lotti, movimenti, documenti o altri impieghi operativi. Sono rimasti invariati i tre prodotti preesistenti. Conservati due sessioni annullate, quattro file, 512 righe Registro e 22 righe Giacenze: solo 118 riferimenti Registro e 22 riferimenti Giacenze ai prodotti eliminati sono stati azzerati. L'audit conserva 33 eventi di eliminazione con anagrafica precedente, associazioni rimosse e identificativi delle righe scollegate. Non sono stati azzerati contatori o cancellati altri dati. Questa manutenzione autorizzata non modifica la regola applicativa che impedisce di cancellare prodotti con collegamenti.

Il codice su Hetzner non è stato aggiornato da questa operazione. La nuova procedura va validata sulla 8082 prima di concordare merge e rilascio.

### Verifiche del confronto Giacenze

- Installazione con lockfile e typecheck superati; nessuna modifica al lockfile.
- API su database temporaneo: 151 file, 1.634 test superati, 5 esclusioni previste. Compresi confronto degli originali ripetuto due volte senza variazioni di lotti, movimenti e sessioni; unità kg/pz, conversioni mancanti, lotti/fondi/scadenze diversi, duplicati e stock locale assente dal file.
- Frontend: 135 file, 900 test superati, inclusi invio del solo file Giacenze, esito verde, differenze, errore e cancellazione del risultato cambiando file.
- Browser su ambiente temporaneo: 12 test superati e 23 esclusioni previste per viewport. Il caso con gli originali importa le 11 giacenze, confronta due volte lo stesso file dalla nuova interfaccia, verifica il messaggio verde e controlla che i movimenti non aumentino.
- Build frontend e budget superati, entry iniziale 394,9 KiB gzip. La prima prova browser ha individuato un selettore errato del test (Area invece di Magazzino), corretto usando il nome accessibile del controllo; la successiva esecuzione completa è passata.
