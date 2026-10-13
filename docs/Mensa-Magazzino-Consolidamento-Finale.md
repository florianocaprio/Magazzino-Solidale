# Mensa/Magazzino — consolidamento finale e pubblicazione

13 ottobre 2026, Europe/Rome. **Sviluppo P55 e UX consolidato e pubblicato;
UAT formalmente chiusa NON attestata.**

## Identità Git verificata dopo il push

- Branch: `codex/magazzino-workflow-unificato`.
- SHA iniziale: `535e5a403fd7eb0d940256de2dc34ce67f7b0166`.
- SHA finale locale, tracking e remoto:
  **`d20b978dbd334c0a77b9a81c76890aa8a9f2cbcd`**.
- Commit: `feat: consolidate Mensa supply preference and request confirmation`.
- Push esplicito non forzato: `git push origin HEAD:refs/heads/codex/magazzino-workflow-unificato`.
- Divergenza finale 0/0; staging vuoto; nessuna modifica tracciata residua.
- Main remoto invariato: `787d7c5436d5fa4c0edb24be373d055946d402ce`.
- Nessun merge, tag, release o deploy.

[Commit pubblicato](https://github.com/florianocaprio/Magazzino-Solidale/commit/d20b978dbd334c0a77b9a81c76890aa8a9f2cbcd)
e [diff dalla base](https://github.com/florianocaprio/Magazzino-Solidale/compare/535e5a403fd7eb0d940256de2dc34ce67f7b0166...d20b978dbd334c0a77b9a81c76890aa8a9f2cbcd).

Questo rapporto è prodotto **localmente dopo la verifica della pubblicazione**,
per registrarne la SHA completa. Non è incluso nel commit appena pubblicato e
non è stato eseguito un secondo commit documentale. I rapporti P55/UX e
l'handover con appendice di consolidamento sono invece inclusi nel commit.

## Candidato e software installato

Il commit contiene il codice già installato sulla 8082, senza nuove modifiche
applicative in questa fase. Tutti i 2081 input del manifest dell'ultimo WEB sono
presenti nel commit e byte-identici ai file del candidato. Fingerprint software:

`3160a750941db0d526f898064f20726ba68bf601a4fb9855355af95c0c59648b`.

L'API installata identifica il manifest P55:
`3359a275fcd8ed02fbe27cf511dc3fdea946a3a96914d20ba983a83feea608e7`.
Le sole sei differenze rispetto a quel contesto sono componente Rifornimenti,
contesto Area, relativi test, i18n Mensa ed E2E correttivo, già presenti nel
candidato UX finale. Backend, test API, schema, migration, contratto, generated,
dipendenze e configurazioni pertinenti coincidono con P55.

Le immagini non sono state ricostruite: conservano le etichette storiche della
base e i fingerprint del working tree da cui furono compilate. Il confronto
degli input dimostra la corrispondenza software; non si dichiara che siano state
compilate originariamente dalla nuova SHA.

### Migration 55

`lib/db/updates/20261013_z_mensa_magazzino_richiesto.sql` è ora pubblicata,
identica al file già installato e al manifest P55. SHA-256:

`5ef0fb3475a27d7435e9bbeee9dd1a32014540290fac473a5fe4b758e1be9f13`.

Prima e dopo il push, `/api/readyz` restituisce HTTP 200, ledger **55/55**,
zero pending, checksum errati, file applicati mancanti o migration fuori ordine.
Nessuna migration o query mutante è stata eseguita per il consolidamento.

## Gate e provenienza dei risultati

| Gate                          | Esito                                                   | Provenienza                                                                                |
| ----------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| API completa                  | 1853 PASS, 0 FAIL, 0 SKIP                               | Riutilizzata P55: JSON e identità degli input riletti                                      |
| Frontend completa             | 627 PASS, 0 FAIL, 105 file                              | Riutilizzata UX: log e identità del candidato finale                                       |
| E2E Mensa                     | 13 PASS, 0 FAIL, 12 skip storici, 0 flaky               | Riutilizzata UX nelle cinque viewport; JSON e codice processo 0                            |
| Fresh/upgrade autentico 54→55 | PASS, legacy NULL, record invariati                     | Riutilizzata P55; snapshot prima/dopo nuovamente confrontati                               |
| Replay/parità                 | PASS                                                    | Risultato replay e ledger riletti; schema fresh/upgrade confrontati identici               |
| Runner migration              | 24 PASS, 0 FAIL, 0 SKIP                                 | Riutilizzato log PostgreSQL e risultato processo 0                                         |
| Typecheck                     | PASS                                                    | Riutilizzato workspace UX finale, sorgenti invariati                                       |
| Codegen deterministico        | PASS                                                    | Pipeline canonica P55 status 0, equal true; contratto/config/generated invariati           |
| Build Linux API/WEB           | PASS                                                    | Log e manifest precedenti, ID delle immagini installate verificati                         |
| Budget WEB                    | PASS: 1402,0 KiB / 388,2 KiB gzip                       | **Rieseguito** sul bundle disponibile `index-CtfHKt_O.js`                                  |
| Prettier                      | PASS                                                    | **Rieseguito** sui 22 file supportati; SQL protetto da checksum                            |
| Diff e staging                | PASS                                                    | **Rieseguiti** diff check, cached check, inventario e confronto contenuto staged/file      |
| File estranei/segreti         | Nessun file estraneo o firma nota di segreto nel commit | Revisione del delta e scansione firme; nessun `.env`, dump, log o artefatto privato staged |
| Git post-push                 | PASS, SHA coincidenti e divergenza 0/0                  | Lettura locale/tracking e `ls-remote` diretto                                              |
| Docker post-push              | 8082 sana, identità invariate; 8083 assente             | **Nuova verifica read-only** dopo il push                                                  |

Le suite precedenti non sono state rieseguite in questo mandato. Non sono
stati introdotti test, skip, retry o cambiamenti agli assert. Nessuna nuova
installazione delle dipendenze o build era necessaria per gli input invariati.
Le failure storiche restano descritte nei rapporti originali.

Evidenze locali: `/private/tmp/magazzino-mensa-preferenza-nv0Q49mM`,
`/private/tmp/magazzino-mensa-inviata-RqFhZeFa` e
`/private/tmp/magazzino-mensa-web-rebuild-pJFSzxlL`.
Le directory e i manifest privati non sono stati pubblicati.

## Inventario esatto pubblicato

**23 file, 2126 inserimenti, 105 rimozioni**, secondo `git show --stat`.

```text
artifacts/api-server/src/routes/mensa.ts
artifacts/api-server/src/routes/richieste-magazzino.ts
artifacts/api-server/tests/mensa-magazzino-correttivo.test.ts
artifacts/magazzino-solidale/e2e/mensa-magazzino-correttivo.spec.ts
artifacts/magazzino-solidale/src/components/mensa-operational-context.test.tsx
artifacts/magazzino-solidale/src/components/mensa-operational-context.tsx
artifacts/magazzino-solidale/src/components/mensa-rifornimenti.test.tsx
artifacts/magazzino-solidale/src/components/mensa-rifornimenti.tsx
artifacts/magazzino-solidale/src/lib/i18n/namespaces/mensa.ts
artifacts/magazzino-solidale/src/pages/richieste-magazzino.tsx
docs/HANDOVER-MAGAZZINO-SOLIDALE-2026-10.md
docs/Mensa-Magazzino-Preferenza-Approvvigionamento.md
docs/Mensa-Richiesta-Inviata-UX.md
lib/api-client-react/src/generated/api.schemas.ts
lib/api-client-react/src/generated/api.ts
lib/api-spec/openapi.yaml
lib/api-zod/src/generated/api.ts
lib/api-zod/src/generated/types/index.ts
lib/api-zod/src/generated/types/listMagazziniMensaParams.ts
lib/api-zod/src/generated/types/richiestaMagazzino.ts
lib/api-zod/src/generated/types/richiestaMagazzinoCreate.ts
lib/db/src/schema/richiesteMagazzino.ts
lib/db/updates/20261013_z_mensa_magazzino_richiesto.sql
```

Rapporti pubblicati:

- [Handover con appendice](https://github.com/florianocaprio/Magazzino-Solidale/blob/d20b978dbd334c0a77b9a81c76890aa8a9f2cbcd/docs/HANDOVER-MAGAZZINO-SOLIDALE-2026-10.md).
- [P55](https://github.com/florianocaprio/Magazzino-Solidale/blob/d20b978dbd334c0a77b9a81c76890aa8a9f2cbcd/docs/Mensa-Magazzino-Preferenza-Approvvigionamento.md).
- [UX](https://github.com/florianocaprio/Magazzino-Solidale/blob/d20b978dbd334c0a77b9a81c76890aa8a9f2cbcd/docs/Mensa-Richiesta-Inviata-UX.md).

## 8082 e risorse protette dopo il push

Confrontati prima/dopo: ID container, immagine, avvio, mount, porte e reti,
senza differenze per WEB/API/PostgreSQL.

| Servizio   | Container ID                                                       | Immagine effettiva                                                        |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| WEB        | `547e8690dd3d556bf732adfc05b0c73b6138e6789e21d67d1f3fdea76feb7b91` | `sha256:e74cd648ab8b47e49878b093db71dd5cb10a6c739c3a79548641a9ca3a1a5da3` |
| API        | `a1b0560a0e930a27b9374e01ff548e4008eee45eabfef1a89a32604376faa6ce` | `sha256:d9c8ba73caa815e2fe7e1e84dea0c32e14388a016444813fbac47b1e3613519d` |
| PostgreSQL | `af6bd975d17d0fb187820b50a860a51075ac8c64656356e59c1c12b7ea402797` | `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea` |

HTTP 200 su `/`, `/config.js`, `/api/healthz`, `/api/readyz`.
Nessun rebuild, restart, deploy, accesso diretto al database, modifica uploads
o volume. Nessuna risorsa Docker creata: non occorre nuovo cleanup.
La preview 8083 resta eliminata, senza container, rete o volumi del suo progetto.
Backup e override Compose restano nella posizione descritta nell'handover.

## Documenti esclusi e stato finale

Preservati fuori dal commit, con hash identici prima/dopo:

```text
docs/M6.2-A-Rilascio-Ufficiale-20261009.md
docs/M6.2-B-Rilascio-20261009.md
docs/M6.2-C-Pubblicazione-Preview.md
docs/M6.2-C-Rilascio-Ufficiale.md
docs/M6.3-Interventi-Rilascio-Ufficiale.md
docs/M6.4-FSE-AGEA-Rilascio-Ufficiale.md
```

Dopo la creazione di questo rapporto, il working tree contiene soltanto questi
sei documenti e il rapporto conclusivo locale come file non tracciati. Codice,
test, schema, generated, migration e rapporti pubblicati sono puliti; staging
vuoto. Il rapporto non è un residuo applicativo non pubblicato.

Nessun blocker tecnico irrisolto per questo consolidamento. Restano **UAT
Mensa/P55/UX non formalmente attestate**, hardware camera/lettore/tablet NE-MAN
e la distinzione intenzionale tra badge COMPLETATA e stato amministrativo
`presa_in_carico` dopo ricezione. Nessuna chiusura amministrativa aggiunta,
nessuna nuova milestone avviata; gli altri rinvii dell'handover restano validi.

**Consegna: sviluppo consolidato e pubblicato sul branch dedicato, pronto per
review indipendente. UAT formalmente chiusa: NON attestata.**
