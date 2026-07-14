# BUG-DB-01: inizializzazione, dati demo e reset ambiente

Questa procedura opera sul database indicato da `DATABASE_URL`. Prima di un
reset totale verificare sempre database, ambiente e backup. Non inserire
password o URL con credenziali in file versionati.

## Bootstrap e dati base

All'avvio l'API inizializza, prima di mettersi in ascolto, soltanto dati base
idempotenti e non personali: ruoli applicativi, configurazione ambiente e
moduli, impostazioni stampa, ruoli volontari, tipi intervento, tipi fornitore e
policy Credito Solidale predefinita. Le configurazioni già personalizzate non
vengono sovrascritte, salvo gli invarianti di sicurezza del ruolo SuperAdmin.

Il seed può essere rilanciato manualmente dalla root del repository:

```sh
pnpm --filter @workspace/api-server environment:data seed-base
```

Su un database nuovo non viene creata una password nota nel codice. Senza la
variabile `SUPER_ADMIN_INITIAL_PASSWORD` resta attivo il flusso di prima
configurazione. Se la variabile è valorizzata, viene creato l'utente tecnico
`sadmin` con cambio password obbligatorio. La variabile deve essere fornita dal
secret manager dell'hosting e non deve essere committata.

## Dati demo sintetici di magazzino

Il seed demo è separato dall'avvio, richiede un utente Super Admin attivo ed è
idempotente:

```sh
pnpm --filter @workspace/api-server environment:data seed-demo-magazzino --super-admin=sadmin
```

Crea esclusivamente record marcati `BUG-DB-01-DEMO`:

- Area Demo e Centro di Ascolto Demo;
- Magazzino Demo Principale e Magazzino Demo Emporio;
- tre fornitori con email `example.org`;
- otto prodotti chiaramente demo;
- otto lotti `LOT-DEMO-001` ... `LOT-DEMO-008`, con quantità ridotte e scadenze future;
- un movimento di carico sintetico per lotto.

Non crea beneficiari, utenti, dati sanitari/sociali, bolle, consegne, movimenti
reali o copie di audit. Le bolle demo sono escluse perché il modello le collega
a beneficiari e flussi operativi. Se un codice demo è già occupato da un record
senza marcatore, il seed si ferma senza appropriarsene.

## Reset demo magazzino

Elimina soltanto il dataset marcato. Non richiede il flag di backup, ma richiede
Super Admin e conferma letterale:

```sh
pnpm --filter @workspace/api-server environment:data reset-demo-magazzino \
  --super-admin=sadmin \
  --confirm="RESET MAGAZZINO DEMO"
```

Il reset si rifiuta se prodotti, lotti o magazzini demo sono stati collegati a
bolle, prenotazioni, scarichi, approvvigionamenti, trasferimenti, consegne,
sessioni/spese Emporio, preferenze beneficiario o movimenti non demo. Area,
centro e fornitori demo vengono conservati se risultano usati da altri record.
Ogni esecuzione riuscita aggiunge un evento di audit e non elimina audit
preesistente.

## Reset totale magazzino

Questo comando elimina tutti i dati operativi di magazzino, non solo quelli
demo. Richiede conferma di backup e frase esatta:

```sh
pnpm --filter @workspace/api-server environment:data reset-magazzino \
  --super-admin=sadmin \
  --backup-confirmed \
  --confirm="RESET MAGAZZINO"
```

Elimina in ordine sicuro sessioni e spese Emporio, prenotazioni, righe e testate
bolla, movimenti, trasferimenti, scarichi, approvvigionamenti, consegne, lotti,
prodotti, fornitori e magazzini. Azzera preventivamente i riferimenti al
magazzino preferito e alle bolle negli interventi. Preserva utenti, ruoli,
configurazione ambiente, moduli, impostazioni e audit.

## Reset completo ambiente operativo

```sh
pnpm --filter @workspace/api-server environment:data reset-ambiente \
  --super-admin=sadmin \
  --backup-confirmed \
  --confirm="RESET AMBIENTE"
```

Comprende il reset totale magazzino e rimuove dati operativi Credito Solidale,
UDS/sociale, beneficiari, turni, mezzi, volontari, zone, centri e aree. Preserva
tutti gli utenti tecnici/applicativi, i ruoli base, configurazione ambiente,
moduli, impostazioni e audit. Rimuove gli ambiti territoriali dagli utenti e
invalida tutte le sessioni, quindi dopo l'operazione è necessario autenticarsi
di nuovo. Non può eliminare l'ultimo Super Admin perché non elimina alcun
utente.

Reset separati `RESET EMPORIO`, `RESET UDS`, `RESET CREDITO` e beneficiari demo
non sono esposti in questa hotfix: le entità condividono riferimenti e non hanno
un discriminatore demo sicuro. Aggiungerli senza uno schema esplicito rischia
cancellazioni parziali. La UI distruttiva Super Admin è rimandata; la CLI riduce
la superficie esposta e rende obbligatorie conferme e backup.

## Configurazione copiabile e dati vietati

Da un altro ambiente è ammessa soltanto una whitelist verificata di dati non
sensibili: definizioni dei ruoli, aree generiche, centri fittizi/non personali,
tipi e categorie, impostazioni stampa, moduli, configurazione ambiente e
causali. Non importare utenti reali, beneficiari o nuclei, dati sanitari/sociali,
colloqui, bolle, consegne, movimenti o audit reali.

## Cookie e hosting

Il client invia esplicitamente le credenziali. L'API accetta richieste con
credenziali solo da origini configurate. Per hosting HTTPS con frontend/API su
origini diverse usare `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none` e valorizzare
`APP_ORIGINS` con le origini frontend separate da virgola. Per sviluppo HTTP
locale usare `COOKIE_SECURE=false` e `COOKIE_SAMESITE=lax`. La combinazione
`SameSite=None` senza cookie secure viene rifiutata all'avvio.
