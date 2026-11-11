-- I profili operativi possono ricevere questa capacità esplicitamente dopo l'aggiornamento.
UPDATE ruoli
SET permessi = permessi - 'magazzino.products.manage'
WHERE NOT is_admin
  AND nome <> 'Coordinatore Centro e Catalogo'
  AND permessi ? 'magazzino.products.manage';
