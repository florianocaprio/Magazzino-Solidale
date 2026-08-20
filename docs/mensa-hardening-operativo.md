# Mensa: aggiornamento operativo e controlli di sicurezza

Questo aggiornamento completa il workflow Mensa senza sostituire il motore di
magazzino. Una Mensa continua a usare il proprio Magazzino associato; consumi e
scarti producono scarichi inventariali FEFO nel registro canonico.

Nel dominio e nell'interfaccia si usa il termine **Area**. I nomi `citta` e
`citta_id` restano esclusivamente identificatori tecnici legacy del database.

## Prima dell'aggiornamento

1. Fermare le scritture applicative e creare un backup PostgreSQL verificabile.
2. Conservare il backup fuori dal container.
3. Eseguire l'aggiornamento prima su una copia recente del database.
4. Registrare i conteggi almeno di `beneficiari`, `prodotti`, `lotti`,
   `movimenti`, `trasferimenti`, `magazzini`, `mense`, `mensa_accessi` e
   `mensa_pasti`.

Esempio Docker, sostituendo nomi e credenziali con quelli dell'ambiente:

```sh
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > mensa-pre-update.dump
docker compose exec -T postgres createdb -U "$POSTGRES_USER" mensa_update_test
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d mensa_update_test --no-owner --no-privileges < mensa-pre-update.dump
```

Il file `lib/db/updates/20260820_audit_mensa_operational_hardening.sql` è
applicato dal runner idempotente del repository:

```sh
DATABASE_URL=postgresql://... pnpm --filter @workspace/db run update
```

Non usare `drizzle-kit push-force`. L'aggiornamento non cancella righe, non
ricrea tabelle e può essere eseguito più volte. Prima di installare i vincoli
esegue preflight espliciti: eventuali sovrapposizioni di abilitazioni principali
attive vengono segnalate e preservate; il trigger viene comunque installato per
impedire nuove sovrapposizioni. La bonifica dello storico richiede una decisione
funzionale, senza cancellazioni automatiche. Valori servizio legacy diversi da
`pranzo`/`cena`, collisioni dopo canonicalizzazione e riferimenti orfani vengono
segnalati; i relativi vincoli restano `NOT VALID` finché i dati non sono
bonificati.

## Controlli dopo l'aggiornamento

- rieseguire gli stessi conteggi e verificare che non siano diminuiti;
- verificare la presenza di `mensa_giornate_servizio`, `mensa_consumi` e
  `mensa_consumi_storni`;
- verificare il trigger `mensa_abilitazioni_principale_overlap_trg`;
- verificare che i vincoli FK accesso/eccezione e pasto/giornata risultino
  validi quando non esistono record orfani;
- eseguire l'aggiornamento una seconda volta per confermarne l'idempotenza;
- eseguire typecheck, test, build Docker e un collaudo applicativo.

## Stati e autorizzazioni

Lo stato del servizio Mensa è separato dallo stato del Magazzino: disattivare il
servizio non modifica o disattiva automaticamente il Magazzino associato.

Il ruolo standard Operatore Mensa può richiedere e ricevere rifornimenti,
gestire tessere e consumi, consultare i report e chiudere una giornata. Non può
spedire trasferimenti, rettificare liberamente lo stock, autorizzare un secondo
pasto o riaprire una giornata. Queste operazioni richiedono rispettivamente
permessi espliciti; i ruoli personalizzati esistenti non vengono modificati.

Le giornate sono identificate da Mensa, data civile Europe/Rome e tipo servizio
(`pranzo` o `cena`). I nuovi accessi memorizzano lo stesso codice servizio, così
i conteggi di chiusura del pranzo e della cena restano separati; gli accessi
legacy senza codice non vengono attribuiti arbitrariamente. Dopo la chiusura non
sono ammessi nuovi pasti, consumi o storni. La riapertura richiede permesso
dedicato, motivo obbligatorio e audit.

## Collaudo minimo

Verificare almeno: scarico FEFO e rollback per giacenza insufficiente;
idempotenza di consumo, pasto e trasferimento; storno tracciato; secondo pasto
con conferma e motivo; abilitazioni future disgiunte e rifiuto di intervalli
sovrapposti; richiesta e ricezione del rifornimento con rifiuto della spedizione
al ruolo standard; paginazione; chiusura/riapertura; report con snapshot storici
e separazione tra stato servizio e stato Magazzino.
