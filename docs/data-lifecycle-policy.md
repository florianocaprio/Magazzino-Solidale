# Policy del ciclo di vita dei dati

Questa matrice distingue le operazioni ammesse sui dati operativi. Le nuove route
devono rispettarla e aggiungere test di regressione prima di introdurre una delete.

| Categoria | Esempi | Policy |
| --- | --- | --- |
| Fatti storici o contabili | movimenti, storni, spese Emporio chiuse, bolle consegnate, consegne effettuate | Append-only o transizione esplicita; hard-delete vietata |
| Workflow attivi | consegne pianificate, bozze non contabilizzate | Cancellazione ammessa soltanto prima dello stato terminale e con RBAC dedicato |
| Anagrafiche referenziate | beneficiari, magazzini, centri, prodotti | Disattivazione/soft-delete; vincoli `RESTRICT` sulle relazioni storiche |
| Configurazione non usata | record tecnici senza dipendenze | Hard-delete ammessa soltanto con controllo referenze e audit amministrativo |

Per Consegne, `DELETE /consegne/{id}` annulla esclusivamente una pianificazione.
Una consegna effettuata è un fatto storico e non può essere eliminata.
