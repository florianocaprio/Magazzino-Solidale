# Magazzino 2.0C — modello reporting

## Contratto unico

Dashboard iniziale, landing `/report`, sezioni integrate, tabelle, grafici,
drill-down, XLSX e PDF consumano i builder server-side e il payload
`reportingModelVersion: MAGAZZINO_2_0C_V1`. Le pagine legacy delegano ai builder
integrati; non mantengono formule parallele.

Ogni KPI espone:

- `exactValue: string | null`, autorevole per contabilità ed export;
- `value: number | null`, sola proiezione visuale per grafici;
- unità semantica (`count`, `pieces`, `kgLt`, `percentage`, `credit`, `days`,
  `average`);
- disponibilità e drill-down.

`null` non diventa zero. I valori Pezzi e Kg/Lt restano separati. Grafici e
formattazione possono arrotondare la proiezione, mai il valore decisionale.

## Fonti e formule principali

| KPI                         | Fonte                    | Formula                                                  |
| --------------------------- | ------------------------ | -------------------------------------------------------- |
| giacenza corrente           | residui Partite          | somma residui per dimensione                             |
| giacenza as-of              | Movimenti                | somma algebrica fino a data/cutoff                       |
| Fondo                       | Movimento                | `movimenti.fondo_origine`                                |
| distribuzione lorda         | Movimenti                | `DISTRIBUZIONE_FINALE` nel periodo                       |
| storni                      | Movimenti                | nature `STORNO` con lineage                              |
| distribuzione netta         | ledger                   | lordo meno compensazioni                                 |
| eventi/pacchi/pasti/persone | Operazione distribuzione | evento distinto; statistiche una volta                   |
| scadenze                    | ledger + Partite         | saldo Partita ricostruito as-of e scadenza alla data finale |
| trasferimenti               | Movimenti                | entrata e uscita separate                                |
| persone uniche note         | sorgenti modulo          | beneficiario distinto affidabile; anonimi esclusi        |

Il report Magazzino/Logistica distingue stock corrente/as-of Pezzi/KgLt,
Partite, scadenze, carichi/scarichi, storni, resi, rettifiche e trasferimenti.
Il report FSE+ usa soltanto il Fondo del Movimento, separa lordo/storni/netto
per Pezzi e Kg/Lt; include Pacchi/Ritiro sede, Domiciliare, Emporio, Mensa e
UDS Strada dal ledger/operazione. Espone qualità, coda amministrativa, export,
riconciliazioni e rilevazioni tramite la sezione operativa.

I moduli conservano la propria semantica: pacchi/eventi/nuclei distinti;
domiciliare senza pacchi inventati; Emporio credito separato dalle quantità;
Mensa pasti da evento e prodotti da Movimenti; UDS anonimi non deduplicati;
Centro di Ascolto senza trasformare interventi sociali in distribuzioni.

## Filtri, scope e drill-down

Periodo, Area Operativa, Centro, Magazzino, Mensa e Zona UDS vengono
riapplicati server-side. Fondo, prodotto, canale e stati FSE+ sono esposti nei
flussi amministrativi pertinenti. I drill-down sono server-side, paginati,
usano lo stesso scope/formula e non includono PII non necessarie.
La sezione FSE+ integrata, le relative filter-options e i drill-down richiedono
sempre `magazzino.fse.view` lato server, oltre allo scope territoriale e di
canale.

## Matrice endpoint legacy

| Endpoint legacy | Builder autorevole | Stato |
| --- | --- | --- |
| `/report/fse-plus` | `buildFsePlusReport` / `/report/fse-plus/integrato` | deprecato, header `Deprecation` e `Link` |
| pagine report legacy | builder integrati | delega, nessuna formula UI parallela |
| endpoint logistici specialistici | service del proprio dominio | mantenuti quando non duplicano KPI integrati |

## Frontend FSE+

`/report/fse-plus` contiene Panoramica, Da rendicontare, Esportazioni,
Riconciliazioni, Indicatori e Anomalie. Il wizard export presenta Magazzino e
periodo, cutoff/formato, preview, qualità, conferma e download. Il wizard di
riconciliazione presenta import AGEA, baseline, cutoff, calcolo, scostamenti,
abbinamenti manuali e chiusura. L'import resta in Carichi e Lotti ed è solo
collegato, non duplicato.

Le sei lingue supportate sono italiano, spagnolo, inglese, francese, tedesco e
arabo. Il warning “nessuna trasmissione automatica” è permanente; il formato
osservato è sempre etichettato come file di controllo non ufficiale.

## Qualità e privacy

Il payload distingue dati mancanti, derivabili e validi. Le anomalie contabili
e FSE+ non sono mascherate da zeri. Export e drill-down escludono nominativi,
codice fiscale, contatti, indirizzi e note riservate; il codice operativo può
essere usato solo quando necessario al controllo e non consente di ampliare lo
scope.
