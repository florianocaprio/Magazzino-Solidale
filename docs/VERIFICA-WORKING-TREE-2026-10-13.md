# Verifica working tree e pubblicabilità dei documenti

13 ottobre 2026, Europe/Rome. Ricognizione del repository
`florianocaprio/Magazzino-Solidale`, branch
`codex/magazzino-workflow-unificato`.

## Base e confronto Git

Prima dello staging documentale, HEAD locale, tracking e riferimento remoto
letto direttamente con `git ls-remote` coincidono:
`d20b978dbd334c0a77b9a81c76890aa8a9f2cbcd`.
Main remoto: `787d7c5436d5fa4c0edb24be373d055946d402ce`.
Staging iniziale vuoto, nessuna differenza dei file tracciati rispetto alla
base e al branch remoto; sette soli file non tracciati, tutti Markdown in docs.

| Categoria di sorgenti                    | Modificati / nuovi non pubblicati prima della verifica |
| ---------------------------------------- | ------------------------------------------------------ |
| Codice applicativo                       | 0                                                      |
| Schema / migration                       | 0                                                      |
| OpenAPI / contratti / generated canonici | 0                                                      |
| Test / harness / script                  | 0                                                      |
| Configurazioni e dipendenze dichiarate   | 0                                                      |
| Documentazione                           | 7 file non tracciati, inventariati sotto               |
| File temporanei non ignorati             | 0                                                      |

Confronti utilizzati: `git diff`, `git diff --cached`, `git diff BASE`,
`git status --short --branch`, `git ls-files --others --exclude-standard`,
inventario separato con `--ignored`. Il confronto esplicito di `artifacts`,
`lib`, `scripts`, Dockerfile, Compose e manifest/lockfile con la base termina
senza differenze.

**Non risultano modifiche funzionali locali escluse dal commit d20b978.**
Questa conclusione riguarda i sorgenti del working tree e il perimetro Git;
non è una nuova prova funzionale dell'applicazione o una ricognizione di tutti
i file esterni al repository sull'host.

## Revisione dei sette documenti

I file sono stati letti e controllati per segreti, riferimenti a credenziali,
dati personali identificabili e metadati tecnici. La scansione di firme note
non ha rilevato chiavi private, token GitHub/OpenAI/AWS o URL PostgreSQL con
password nei sette documenti. La lettura ha comunque individuato contenuti
che rendono due rapporti inadatti alla pubblicazione integrale.

| File locale                                     | Valutazione                                                                                                                         | Decisione                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `docs/M6.2-A-Rilascio-Ufficiale-20261009.md`    | Associa nomi e ID di beneficiari a stato di accesso al servizio e credito                                                           | **Escluso**, preservato integralmente locale                                                |
| `docs/M6.2-B-Rilascio-20261009.md`              | Verbale tecnico; conteggi aggregati, hash, immagini e percorsi operativi; nessuna anagrafica beneficiario o valore segreto rilevato | Pubblicabile                                                                                |
| `docs/M6.2-C-Pubblicazione-Preview.md`          | Contiene riferimento diretto al file privato delle credenziali e indicazioni dell'account UAT                                       | **Escluso**, preservato integralmente locale; nessuna password in chiaro rilevata nel testo |
| `docs/M6.2-C-Rilascio-Ufficiale.md`             | Verbale tecnico con limiti di smoke/restore espliciti; metadati aggregati, senza credenziali o anagrafiche beneficiari rilevate     | Pubblicabile                                                                                |
| `docs/M6.3-Interventi-Rilascio-Ufficiale.md`    | Verbale tecnico/UAT, immagini e verifiche aggregate; nessun contenuto di dossier o credenziale rilevato                             | Pubblicabile                                                                                |
| `docs/M6.4-FSE-AGEA-Rilascio-Ufficiale.md`      | Verbale storico NO-GO, checksum e metadati operativi; nessun dato individuale o valore segreto rilevato                             | Pubblicabile, preservando il NO-GO storico                                                  |
| `docs/Mensa-Magazzino-Consolidamento-Finale.md` | Rapporto tecnico di pubblicazione d20b978, inventario e gate; nessun dato individuale beneficiario o credenziale rilevato           | Pubblicabile                                                                                |

I percorsi locali di repository/backup/evidenze, i digest, i nomi delle risorse
Docker e i conteggi aggregati presenti nei cinque rapporti idonei sono
metadati tecnici. Non vengono inclusi i file privati cui rinviano, né contenuti
di dump, configurazioni ambiente, snapshot di record o credenziali. Il nome
del responsabile del progetto è usato come attribuzione della validazione,
non come anagrafica di un beneficiario.

I sette documenti originali non sono stati riscritti, anonimizzati o formattati
in questa fase. Per pubblicare eventualmente i due esclusi servirà una copia
minimizzata che elimini le associazioni personali e i riferimenti di accesso,
senza alterare la cronologia tecnica.

Le dichiarazioni «locale/non committato» e gli stati 8082/8083 contenuti nei
rapporti si riferiscono alla data della rispettiva esecuzione. La loro
pubblicazione documentale successiva non cambia quegli esiti. In particolare,
il NO-GO del primo rilascio M6.4 resta storico, riconciliato con gli interventi
successivi nell'handover e nel rapporto Mensa/Magazzino.

## File ignorati: inventario distinto dal delta funzionale

La rilevazione iniziale comprende **54428 entry ignorate** (file e link
elencati da Git), tutte lasciate in sede:

| Categoria                       | Entry | Motivo di esclusione da Git                                                                  |
| ------------------------------- | ----: | -------------------------------------------------------------------------------------------- |
| Dipendenze `node_modules`       | 52187 | Installazioni locali e link di workspace, non sorgenti da pubblicare                         |
| Build compilate `dist`          |  2219 | Output rigenerabili, non modifiche ai sorgenti canonici                                      |
| Cache TypeScript `.tsbuildinfo` |     7 | Stato incrementale locale                                                                    |
| Ambiente `.env.docker`          |     1 | Configurazione privata; contenuto non letto né pubblicato                                    |
| Servizio/test                   |     2 | `.DS_Store` e `artifacts/magazzino-solidale/test-results/playwright/.last-run.json`          |
| Backup in `backups/`            |    12 | Dump/SQL/archivi di dati storici, non migration canoniche; contenuto non letto né pubblicato |

Le build si distribuiscono in `artifacts/api-server/dist` (10),
`artifacts/magazzino-solidale/dist` (134), `artifacts/mockup-sandbox/dist` (3),
`lib/api-client-react/dist` (10), `lib/api-zod/dist` (1936), `lib/db/dist` (126).
Non risultano ulteriori entry ignorate fuori da queste categorie. Nessun file
ignorato è stato aggiunto forzatamente allo staging, modificato o eliminato.

È stato generato fuori repository un inventario privato completo, con ogni
percorso ignorato e i sette documenti iniziali con SHA-256. Include nomi di file
privati, ma non il contenuto di `.env`, dump o credenziali. È consegnato localmente
all'utente e non fa parte del commit; conteggi e ambito sono quelli della
rilevazione iniziale. Le directory esterne al repository non rientrano nel
working tree censito.

## Perimetro documentale autorizzato

Il commit documentale include esattamente questi sei file:

```text
docs/M6.2-B-Rilascio-20261009.md
docs/M6.2-C-Rilascio-Ufficiale.md
docs/M6.3-Interventi-Rilascio-Ufficiale.md
docs/M6.4-FSE-AGEA-Rilascio-Ufficiale.md
docs/Mensa-Magazzino-Consolidamento-Finale.md
docs/VERIFICA-WORKING-TREE-2026-10-13.md
```

Prettier check dei documenti, diff check, inventario staged e controllo segreti
sono i controlli pertinenti. Nessuna suite applicativa, installazione,
migration, operazione Docker, accesso al database o deploy in questa fase.
Nessun cambio di codice o configurazione, nessun merge/push su main.
I due documenti esclusi restano non tracciati con contenuto invariato.

La SHA documentale finale è quella del commit che contiene questo verbale,
con genitore d20b978, ed è consegnata dopo verifica di HEAD/tracking/remoto.
Non si inserisce nel documento un hash autoreferenziale non ancora esistente.
