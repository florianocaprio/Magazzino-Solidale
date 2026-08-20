# Migrazione Area Operativa

`Area Operativa` è il confine organizzativo e territoriale di visibilità dei
dati. È una **HARD data visibility boundary** e non coincide con le aree RBAC
(`sociale`, `magazzino`, `mensa`, `uds`, ecc.), che restano autorizzazioni
funzionali. La Zona UDS rimane un sotto-scope/preferenza dell'Area Operativa
secondo le regole già esistenti.

L'update `lib/db/updates/20260820_z_area_operativa_migration.sql` rinomina
tabella, colonne, sequence, indici e constraint PostgreSQL in-place. Non copia,
elimina o rigenera record e fallisce esplicitamente se rileva entrambi i nomi
old/new oppure se sono entrambi assenti.

## Applicazione

Eseguire prima backup e preflight sul database target, poi:

```bash
DATABASE_URL=<database> pnpm --filter @workspace/db run update
DATABASE_URL=<database> pnpm --filter @workspace/db run update
```

La seconda esecuzione deve concludersi senza modifiche. Dopo l'update verificare
row count, ID, distribuzione delle FK, riferimenti orfani, sequence e vincoli.

## Rollback manuale

Il rollback è intenzionalmente fuori da `lib/db/updates/`, quindi non può essere
eseguito automaticamente dal runner. Richiede fermo applicativo, backup valido
e versione applicativa precedente già pronta:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f lib/db/rollbacks/20260820_area_operativa_migration_rollback.sql
```

Lo script è simmetrico e data-preserving: ripristina i nomi `citta`,
`citta_id`, `citta_id_seq`, indici e constraint originari. Dopo il rollback,
distribuire il codice precedente e ripetere i controlli di cardinalità e FK.
Non eseguire il rollback mentre istanze API basate sul nuovo contratto sono
attive.
