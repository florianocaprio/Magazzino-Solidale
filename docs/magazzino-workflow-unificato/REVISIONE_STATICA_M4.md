# M4 — review statica post-code-review CR-M4-01

Data: 24 settembre 2026. Base pubblicata `a64db9307008238cdc4265b5398fe2f0aa83b0fe`, branch `codex/magazzino-workflow-unificato`. Questa è la verifica locale del solo hardening CR-M4-01, non la nuova code review indipendente ChatGPT né una validazione manuale M4.

## Causa e impatto

Il documento M4A ammette un solo incaricato: `volontarioConsegnaId` oppure `trasportatoreNome`. Il comando M4B.2 `Affida` richiedeva sempre un nome libero nella UI e lo salvava anche quando la Bolla Pronta aveva già un volontario censito. Potevano così coesistere i due incaricati, rendendo ambigui dettaglio, PDF e audit; il reinserimento era inutile anche quando esisteva già un nome esterno.

## Delta revisionato

- Il backend legge l'incaricato dal documento bloccato nella transazione. Con volontario presente, accetta il comando senza nome e rifiuta con `400` un nome esterno; se il dato storico contenesse entrambi, non prosegue (`409`). Con nome esterno già assegnato, lo conserva e non permette di sostituirlo in `Affida`. Senza incaricato, richiede il nome libero valido (massimo 120 caratteri tramite lo schema già esistente). La scelta è effettuata prima di movimenti, stato, audit e ricevuta; il replay idempotente conserva un solo scarico.
- La UI mostra l'incaricato già assegnato e non presenta né invia il campo libero. Il campo compare, ed è obbligatorio, solo se la Bolla non ha incaricato. La nuova etichetta è localizzata nei sei linguaggi del namespace esistente.
- Le regressioni API CR-M4-01-A…E provano scelta esclusiva, rifiuti senza effetto, conservazione del nome, limite di lunghezza, stock, ledger, assenza di distribuzione anticipata e retry. CR-M4-01-F prova nel browser i tre rami UI e il payload effettivo.

Il confronto con la base conferma nessun delta a schema/migrazioni (nessuna 43), OpenAPI, generated, modello inventariale, reporting, runtime o permessi. Il contratto OpenAPI rendeva già opzionale `trasportatoreNome`, quindi non è richiesto codegen. POST/PATCH Bolla mantengono il controllo XOR preesistente; `Affida` ora lo rispetta. Non sono introdotti cambi di incaricato dopo `Pronta`.

La review locale non trova altri finding bloccanti nel delta circoscritto. Esiti dinamici, evidenze mantenute e limiti del test sono in `ESITI_TEST_M4.md`. M4 resta `OK-TEST-M4/NE-MAN`; una nuova review ChatGPT è successiva.
