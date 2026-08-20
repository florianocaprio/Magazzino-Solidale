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

## Procedura forward

La migrazione è un rename atomico e non mantiene alias legacy: il vecchio
backend usa `citta`/`citta_id`, mentre il nuovo database espone soltanto
`aree_operative`/`area_operativa_id`. Vecchia applicazione e nuovo schema non
possono quindi coesistere, nemmeno durante un rolling deploy.

Eseguire nell'ordine:

1. creare un backup del database e verificarne leggibilità e ripristinabilità;
2. completare il preflight su schema, cardinalità, riferimenti e stato degli
   oggetti PostgreSQL;
3. fermare **tutte** le istanze della vecchia API/app e impedire nuovo traffico;
4. eseguire l'update DB:

```bash
DATABASE_URL=<database> pnpm --filter @workspace/db run update
DATABASE_URL=<database> pnpm --filter @workspace/db run update
```

5. verificare schema, FK, row count, ID, distribuzione dei riferimenti, valori
   NULL, riferimenti orfani, sequence e vincoli; la seconda esecuzione deve
   concludersi senza modifiche;
6. distribuire e avviare **solo** la nuova versione applicativa;
7. eseguire gli smoke test su health, autenticazione e moduli principali;
8. riaprire il servizio soltanto dopo l'esito positivo di tutte le verifiche.

## Rollback manuale

Il rollback è intenzionalmente fuori da `lib/db/updates/`, quindi non può essere
eseguito automaticamente dal runner. Richiede backup valido e versione
applicativa precedente già pronta. La sequenza operativa completa è:

1. fermare tutte le istanze della nuova versione e bloccare il traffico;
2. eseguire il rollback DB:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f lib/db/rollbacks/20260820_area_operativa_migration_rollback.sql
```

3. verificare schema, FK, cardinalità, riferimenti e sequence ripristinati;
4. distribuire e avviare la vecchia versione applicativa;
5. eseguire gli smoke test e riaprire il servizio solo dopo esito positivo.

Lo script è simmetrico e data-preserving: ripristina i nomi `citta`,
`citta_id`, `citta_id_seq`, indici e constraint originari. Non eseguire mai il
rollback mentre istanze basate sul nuovo contratto sono attive.
