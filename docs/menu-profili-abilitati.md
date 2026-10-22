# Menu assegnati e utenti con permessi aggiuntivi

Branch: `codex/menu-profili-abilitati`. Intervento successivo alla PR #31, senza modificare i cinque documenti locali estranei al task.

## Diagnosi remota e requisito confermato

Ricognizione Hetzner del 22 ottobre 2026 in transazioni `READ ONLY`: il ruolo Operatore Centro ha esattamente Generale, Magazzino, Centro di Ascolto, Logistica e Analisi. I suoi permessi appartengono interamente alla dotazione ordinaria di queste Aree. Anche gli altri sette ruoli operativi corrispondono ai profili standard del codice. Nessun account, ruolo o modulo remoto modificato durante la diagnosi; nessun dato personale o credenziale incluso in questo documento.

La causa del menu Emporio indesiderato è nel codice: il preset standard Sociale comprende `credito.view`, `credito.quota.manage` e Accessi Emporio, necessari alla scheda beneficiario. Le voci globali Credito/Accessi erano visibili anche con la sola Area Sociale o UDS. Il bootstrap attuale crea soltanto i ruoli mancanti e non riscrive quelli esistenti: il caso segnalato non richiede una revoca di permessi aggiunti dal deploy.

Floriano ha confermato di conservare Credito/Accessi nella scheda beneficiario, senza aprire il menu Emporio quando non assegnato. Ha inoltre confermato che un'aggiunta rispetto alla dotazione standard debba essere riconoscibile come **UTENTE SPECIALE**, mantenendo standard i profili ridotti come Volontario. Eventuali extra remoti vanno rimossi solo dopo un confronto documentato, senza aggiungere diritti o cambiare ruoli/Aree assegnate. La ricognizione corrente non ne individua: nessuna bonifica DB necessaria.

## Correzione

- Tutti i gruppi di navigazione operativi corrispondono a un'Area assegnata. Le funzioni condivise mantengono un solo ingresso dentro una delle Aree già assegnate: per esempio Consegne/Turni del Volontario in Logistica, Bolle/Richieste del Sociale nel Centro e Mappa/Report del Magazzino nel Magazzino. Il gruppo principale resta invariato quando autorizzato. Restano le eccezioni preesistenti per supporto pubblico e amministrazione.
- Le pagine generali Emporio richiedono il menu Emporio oppure l'esatta aggiunta speciale. I permessi standard condivisi del Centro continuano a funzionare nella scheda beneficiario ma non aprono automaticamente pagine o gruppo Emporio. Un'aggiunta già autorizzata dalle policy operative, per esempio Credito per UDS, compare come sola sottofunzione dentro UDS; non abilita tutto Emporio.
- `AuthUser.permessiSpeciali` è un campo opzionale additivo, calcolato dal server sia al login sia alla lettura dell'identità corrente. La classificazione usa l'unione degli ordinari delle Aree e dei profili standard applicabili, compreso Volontario; non dipende dal nome del ruolo, non aggiunge grant e non modifica dati persistiti. Admin/SuperAdmin non sono classificati come eccezioni. Il badge compare nel profilo personale e nel collegamento personale del menu; sparisce alla revoca dell'aggiunta.
- Restano invariati i controlli server su grant, Area territoriale, moduli e workflow. L'indicatore è una classificazione della configurazione, non una nuova autorizzazione. OpenAPI e client React/Zod rigenerati con il comando canonico; nessuna migrazione, dipendenza o modifica allo schema DB.

## File

- API: `artifacts/api-server/src/lib/roleSpecialPermissions.ts`, `routes/auth.ts`; test `role-special-permissions.test.ts` e `bug6-rbac-session.test.ts`.
- UI: `components/layout.tsx`, `App.tsx`, `lib/service-menu-access.ts`, `lib/auth-cache.ts`, `pages/profilo.tsx` e traduzioni `lib/i18n/namespaces/profile.ts`, sotto `artifacts/magazzino-solidale/src`.
- Regressioni UI: `components/layout-maps-navigation.test.tsx`, `components/modulo-route-guard.test.tsx`, `lib/navigation-permissions.test.ts`, `pages/profilo.test.tsx`; browser `artifacts/magazzino-solidale/e2e/bug6-rbac.spec.ts`.
- Contratto: `lib/api-spec/openapi.yaml`; generati React `api.schemas.ts`, Zod `api.ts` e `types/authUser.ts`.

## Verifiche

Installazione frozen e codegen canonico PASS, lockfile invariato; typecheck PASS. Suite UI completa **133 file / 885 PASS**, incluse tutte le 256 combinazioni delle otto Aree operative, raggruppamento dei workflow condivisi, pagine Emporio, aggiunte speciali e revoca dell'etichetta. API Core PASS; General e browser sono in esecuzione e non sono ancora dichiarati superati.

I test mutanti usano esclusivamente i database temporanei attestati del runner `scripts/quality-gates-run.mjs`, mai 8082 o Hetzner. Nessun merge o deploy eseguito al momento di questa ricevuta iniziale. Il rilascio richiede nuove immagini API e WEB; i ruoli remoti standard devono restare invariati.

## Collaudo conclusivo del candidato

Sorgente applicativa esatta: `967a56d0308695f16f5d5bd8cd3ed50babdbde60`. Test Core **85 PASS**, General **1.608 PASS / 7 condizionali SKIP**, zero FAIL; nuova classificazione e aggiunta/revoca rilette con sessioni autentiche. Suite UI **133 file / 885 PASS**. Specifica browser RBAC completa **85/85 PASS**, zero SKIP/FAIL/flaky, sui cinque viewport: profili standard, Centro con cinque menu senza Emporio, eccezione esplicita dentro UDS con etichetta, PDF Volontario e revoche di permessi/moduli. Non è una campagna completa di tutte le 50 specifiche browser o delle otto suite API.

Runner locali: `CI_RESULTS_DIR=test-results/quality-gates/api/menu-profili-r1 node scripts/quality-gates-run.mjs api core general` e `CI_RESULTS_DIR=test-results/quality-gates/browser/menu-profili-r1 node scripts/quality-gates-run.mjs browser bug6-rbac.spec.ts`. Cleanup dei database/reti temporanei completato; nessun volume creato.

API/WEB della **8082 ricompilate e attive**, revisione `967a56d03086`, con backup privato e verifica di integrità di ruoli, account, moduli, mount e ambiente. PostgreSQL conserva container e avvio. Home realmente servita dall'immagine candidata; health/readiness e pagina profilo HTTP 200. Budget sull'immagine **394,5 KiB gzip / 400 KiB**.

Build candidate anche su Hetzner, da archivio Git SHA-256 `921a1c4c0f817b5c9977e6177701f860f4f051014e3b8212230be6a77448eb77`: API/WEB PASS, budget Linux **395,7 KiB gzip / 400 KiB**. Nessuna attivazione produttiva: i servizi pubblici conservano `6d659e4`. Backup online privato coerente con servizi attivi; ripristino effettivo in PostgreSQL isolato, confronto delle 57 tabelle e file persistenti, doppio replay migrazioni **63 → 63 PASS**; risorse di ripristino temporanee rimosse. Nessuna bonifica o variazione di account, ruoli e moduli.

La ricevuta finale è solo documentale: l'albero applicativo resta identico al candidato collaudato. Il candidato parte dal main della PR #31 e include anche il profilo personale email/password, il cui deploy Floriano aveva chiesto di concordare separatamente. Prima dell'attivazione si richiede quindi di confermare se pubblicare insieme le due modifiche; non si considera il precedente rinvio implicitamente revocato.
