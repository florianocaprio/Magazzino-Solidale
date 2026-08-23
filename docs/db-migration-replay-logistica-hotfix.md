# DB Gate Hotfix — replay FK Logistica

## Contesto

Il runner `lib/db/scripts/apply-updates.mjs` legge e ordina lessicograficamente
tutti i file SQL, quindi li riesegue integralmente a ogni `db update`. Anche
l'entrypoint Docker dell'API esegue `db update` prima di avviare il server.
Ogni aggiornamento deve pertanto essere replay-safe.

La migration `20260819_audit_centro_ascolto_hardening.sql` riconosce la FK di
`turni_volontari.turno_id` tramite il nome legacy
`turni_volontari_turno_fk`. Se trova soltanto una FK RESTRICT con un altro nome,
ricrea una seconda FK `ON DELETE CASCADE`.

La successiva `20260822_logistica_residual_reconciliation.sql` individua la FK
per relazione e colonna, ma seleziona un solo risultato con `LIMIT 1`. In
presenza di CASCADE e RESTRICT può quindi lasciare due vincoli o tentare di
ricreare un nome canonico già occupato.

## Replay guard forward-only

`20260821_zz_logistica_turno_fk_replay_guard.sql` viene ordinata dopo tutte le
migration del 20260821 e prima della riconciliazione del 20260822. Le migration
consolidate non vengono modificate.

Il guard identifica esclusivamente le FK con questa semantica:

- tabella sorgente `public.turni_volontari`;
- singola colonna sorgente `turno_id`;
- tabella destinazione `public.turni`;
- singola colonna destinazione `id`;
- `contype = 'f'`.

Se esiste già una sola FK canonica RESTRICT, non esegue DDL. In ogni altro
stato elimina esclusivamente i constraint semanticamente equivalenti e crea:

```text
turni_volontari_turno_restrict_fk
FOREIGN KEY (turno_id) REFERENCES turni(id)
ON DELETE RESTRICT NOT VALID
```

Il nome canonico occupato da un constraint semanticamente diverso è un errore
bloccante. La migration non contiene cancellazioni o riscritture di righe
business.

## Test della catena

`db-logistica-residual-migration.test.ts` applica in sequenza:

```text
20260819_audit_centro_ascolto_hardening.sql
→ 20260821_zz_logistica_turno_fk_replay_guard.sql
→ 20260822_logistica_residual_reconciliation.sql
```

Sono coperti gli stati iniziali senza FK, solo CASCADE, RESTRICT legacy,
RESTRICT canonica, CASCADE + RESTRICT, due RESTRICT e più duplicati. Due replay
completi consecutivi devono terminare con una sola FK RESTRICT canonica.

Il test verifica inoltre:

- conteggi invariati per `turni`, `turni_volontari` e `consegne` durante i replay;
- errore bloccante se il nome canonico ha una semantica diversa;
- `SQLSTATE 23503` sul DELETE diretto di un turno referenziato;
- permanenza del turno e dell'assegnazione dopo il DELETE rifiutato;
- ordinamento lessicografico effettivo della migration.

Il gate operativo esegue anche due `pnpm --filter @workspace/db run update`
consecutivi su PostgreSQL isolato e verifica la FK finale. Il gate Docker
costruisce le immagini, avvia lo stack, controlla i log dell'API e ripete il
controllo dopo il restart del container.

## Esito del gate 2026-08-23

- entrambi i replay completi del runner sono terminati con exit code 0;
- dopo ogni replay è rimasta una sola FK canonica con delete action RESTRICT;
- durante i replay i conteggi sono rimasti `turni=2`,
  `turni_volontari=377`, `consegne=338`;
- la suite API ha chiuso 82/82 file, 940 test passati e 2 skip previsti;
- la suite frontend ha chiuso 46/46 file e 224/224 test;
- DB e API Docker sono risultati healthy, il web è stato avviato e l'API è
  tornata healthy dopo il restart;
- nei log del replay Docker non compaiono `duplicate constraint` o
  `Aggiornamento DB FALLITO`.

## Debito architetturale

Un migration ledger con checksum eviterebbe il replay globale e renderebbe
esplicito lo stato applicato di ogni database. Rimane `ARCHITECTURAL_DEBT`: non
viene introdotto da questo hotfix, che conserva runner e deploy esistenti.
