-- M5C1-R2: la gestione degli Enti Esterni appartiene al Centro di Ascolto.
-- Solo il ruolo canonico Magazzino perde il grant di scrittura; nessun dato Ente
-- né ruolo custom, amministrativo o sociale viene modificato.
UPDATE ruoli
SET permessi = (
  SELECT COALESCE(jsonb_agg(p.value ORDER BY p.ordinality), '[]'::jsonb)
  FROM jsonb_array_elements_text(ruoli.permessi) WITH ORDINALITY AS p(value, ordinality)
  WHERE p.value <> 'enti-destinatari.manage'
)
WHERE nome = 'Operatore Magazzino'
  AND is_admin = false
  AND permessi ? 'enti-destinatari.manage';
