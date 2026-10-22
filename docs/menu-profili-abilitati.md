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
