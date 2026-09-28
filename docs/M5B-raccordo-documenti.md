# M5B — raccordo Richiesta Magazzino → documento M4

Stato: sviluppo nel working tree sulla base `cfb53127ecc3a31756aedf8db1e5aefc62a7f346`; **non ancora collaudato formalmente né applicato al Docker/DB persistenti**. Le prove manuali TM-01…TM-30 del Word sono criteri di accettazione proposti, non esiti acquisiti. Floriano ha riferito una verifica manuale M5A positiva; `docs/M5A-test-report.md` documenta invece il precedente collaudo automatico parziale e i blocchi host WEB/E2E. Queste evidenze restano distinte.

## Decisioni e responsabilità

- `richieste_magazzino_documenti` è l'unica relazione autorevole: FK tipizzata a Bolla o Trasferimento, indice parziale su un solo documento corrente per richiesta e indici unici sulle due FK documentali. Gli annullati restano storici; consegnato/completato/rientrato/stornato non libera lo slot. Non c'è backfill.
- Una richiesta Beneficiario o Ente crea solo una Bolla M4 in bozza, senza righe e senza prenotazioni; la composizione e la conferma avvengono nell'editor M4. Una richiesta Magazzino crea un Trasferimento M4 `richiesto` con le righe richieste dal validatore M4. Il documento, non la richiesta, conserva il Magazzino di evasione e la sua versione.
- La richiesta resta `presa_in_carico`. Il riepilogo `documentoCorrente` e lo storico sono derivati con query batch; `bozza`/`richiesto` = in preparazione, `confermato`/`preparato` = pronta. Gli stati successivi mantengono l'esito logistico M4; uno stato sconosciuto non autorizza una nuova evasione. M5B non chiude positivamente il bisogno: questa scelta è M5C.
- Solo l'annullamento ordinario M4 pre-uscita cessa il collegamento nella sua stessa transazione, incrementa la versione della richiesta e conserva la relazione storica. L'annullamento richiesta è negato con documento corrente. Nessun documento esistente viene agganciato retroattivamente.
- `interventi_deleghe_m4` registra la prima delega materiale catalogata di un Intervento sociale. Prima della delega si verifica l'assenza di precedenti consegne catalogate, operazioni e movimenti legacy. Dopo la delega gli incrementi catalogati su salva-operatività/concludi sono respinti, anche se la prima Bolla è annullata. Attività sociali non inventariali, UDS e materiali liberi restano nel percorso originario. Una richiesta autonoma da Beneficiario non deduplica aiuti di Interventi distinti.
- Il grant aggiuntivo è `richieste_magazzino.prepare` per il ruolo Magazzino standard. Non sostituisce `view` né i grant M4 e non è attribuito automaticamente ai ruoli custom. La creazione Bolla richiede MAGAZZINO_SOLIDALE+BOLLE e `bolle.manage`; il Trasferimento MAGAZZINO_SOLIDALE+TRASFERIMENTI e `magazzino.transfers.create`, senza dipendenza da CONSEGNE.

## Contratto e navigazione

- `POST /api/richieste-magazzino/:id/documento`: chiave idempotente, versione richiesta, Magazzino di evasione, righe solo per Trasferimento. Tipo, destinatario e sorgente provengono dalla richiesta. La transazione comprende verifica, eventuale delega, creazione M4, relazione, versione, audit M4/M5B e ricevuta in `comandi_operativi`.
- `GET /api/richieste-magazzino/:id/documenti`: corrente e precedenti minimizzati. Lista e dettaglio richieste includono il riepilogo batch, senza chiamate per-riga. `GET /api/documenti-operativi/:tipo/:id/richiesta` espone il solo ID/codice/percorso dell'origine, subordinato ai grant e allo scope.
- Percorso UI: Richieste al Magazzino → **Prepara documento**, **Magazzino di evasione**, editor righe M4 per Trasferimento → **Apri documento** in `/bolle?bollaId=…` o `/trasferimenti?trasferimentoId=…`; nella vista documento appare **Richiesta origine**. La sezione **Documenti precedenti** conserva gli annullati. Il Centro vede solo il riepilogo; aprire il documento completo resta soggetto ai permessi M4.
- Errori attesi: input/ID malformato 400, sessione 401, grant/modulo/scope 403 o 404, versione/documento corrente/delega/idempotenza incompatibile 409. La ricevuta di replay restituisce il risultato originale; la UI ricarica il dettaglio corrente separatamente.

## Protocollo dei lock

1. Creazione: advisory della chiave comando → attore/ruolo corrente → advisory Intervento se presente → advisory richiesta e riga richiesta `FOR UPDATE` → soggetto e Magazzino → Intervento `FOR UPDATE`/delega → codice e creazione M4 → relazione → audit/ricevuta.
2. Scarico legacy Intervento: advisory Intervento prima della riga Intervento `FOR UPDATE` e dell'incremento inventariale. Vince un solo percorso; il perdente riceve un conflitto. La delega e il divieto sono permanenti fino a una decisione esplicita futura.
3. Composizione/preparazione/annullamento diretto M4 collegato: advisory comando M4 → advisory/riga richiesta → relazione → riga Bolla/Trasferimento → riserve e lotti M4. L'annullamento M4 cessa la relazione prima del commit. Gli endpoint M4 non collegati restano invariati.
4. Annullamento/modifica/presa in carico M5A: advisory Intervento se presente → advisory/riga richiesta → soggetto. Questo ordine evita l'inversione richiesta/soggetto con la nuova creazione.

La migration M5B è `20260926_m5b_raccordo_documenti.sql`, successiva alle 43 migration M5A. Contiene solo nuove relazioni e indici; non cambia stock, richieste o documenti esistenti. La parità schema/migration, l'upgrade autentico 43→44 e le race PostgreSQL restano prove obbligatorie del futuro `##test` effimero. Nessuna migration è stata applicata in questa fase.

## M5B-P0 — correzioni circoscritte

- La coda M5A ora permette al Magazzino assegnato a un Centro di vedere richieste operative della stessa Area con `centroAscoltoId=null`; le richieste sociali restano limitate al Centro reale. Questo serve i casi Ente/Trasferimento TM-19/20 senza ampliare il dossier Beneficiario.
- Il refresh della richiesta invalida anche lo storico. Il dettaglio Bolla non chiama la directory Beneficiari se il Magazzino non ha `beneficiari.view`.
- I soli due ingressi legacy che possono aumentare `quantitaConsegnata` catalogata (salva-operatività e concludi) condividono il lock della delega. L'identità e la composizione dei documenti collegati sono guardate anche da API M4 dirette.
- Il replay dell'annullamento M4 già riuscito può rileggere la ricevuta anche quando il collegamento è ormai storico; la modifica ordinaria di un documento con collegamento cessato resta vietata. La regressione PostgreSQL è predisposta per il futuro `##test`.

## Scheda UAT proposta, non eseguita

Nessun account, password, codice richiesta o URL di un futuro ambiente candidato viene inventato qui. L'harness `##test` dovrà creare dati sintetici su PostgreSQL effimero, riportare URL/build reale, ledger e codici richiesta nella scheda di consegna, e consegnare le credenziali fuori da documenti pubblicabili. Non usare dati reali di assistiti.

| Casi Word | Azione/schermata effettiva                                                                                          | Stato                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| TM-01…10  | `/richieste-magazzino`: invio, modifica, origine Intervento, annullamento, presa in carico, scope e concorrenza M5A | Piano manuale, non rieseguito qui                  |
| TM-11…18  | Dettaglio richiesta → Prepara documento → `/bolle` → righe/conferma/annulla; concorrenza e ingresso diretto M4      | Atteso, NE-MAN                                     |
| TM-19     | Richiesta operativa Magazzino → editor righe Trasferimento M4 → `/trasferimenti`                                    | Atteso, NE-MAN                                     |
| TM-20     | Richiesta operativa Ente → Bolla Ente M4                                                                            | Atteso, NE-MAN                                     |
| TM-21…22  | Intervento origine, gate erogazione pregressa e delega permanente a M4                                              | Atteso, NE-MAN; race richiede PostgreSQL           |
| TM-23…27  | Ultima unità, grant, mutazione contesto, moduli, decimali e storico                                                 | Atteso, NE-MAN; vincoli/race richiedono PostgreSQL |
| TM-28…29  | Bolla M4 affidata/consegnata, mancato esito e rientro senza nuova evasione                                          | Atteso, NE-MAN                                     |
| TM-30     | Flussi M4 non collegati, FSE+, Mensa, Emporio, UDS                                                                  | Regressione futura, NE-MAN                         |

I prodotti/partite richiesti per il collaudo sono quelli della specifica M5B (10+10 pz con scadenze D+30/D+90, 5 pz per Trasferimento, 3,000 kg per 0,250 kg, ultima unità 1 pz e lotto scaduto). Sono **fixture da preparare**, non dati creati nel persistente.

## Limiti e gate successivi

In sviluppo sono consentiti typecheck, codegen e test statici mirati. Questo documento non attesta migration riuscita, assenza di doppio scarico né esito dei test TM. Il successivo `##test` deve eseguire PostgreSQL reale effimero (fresh/upgrade 43→44, FK e indici, transazioni/race, rollback, digest e quantità esatte), suite API/frontend complete, build WEB Linux compatibile, budget, E2E in ambiente controllato e review di scope. Il Docker e il DB persistenti restano intatti.
