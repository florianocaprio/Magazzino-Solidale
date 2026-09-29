-- M5C1: il solo ruolo canonico Sociale non riceve più comandi Bolla.
-- Nessun documento, utente, ruolo custom o movimento inventariale è modificato.
UPDATE ruoli
SET permessi = (
  SELECT COALESCE(jsonb_agg(p.value ORDER BY p.ordinality), '[]'::jsonb)
  FROM jsonb_array_elements_text(ruoli.permessi) WITH ORDINALITY AS p(value, ordinality)
  WHERE p.value NOT IN ('bolle.manage', 'bolle.deliver', 'bolle.cancel')
)
WHERE nome = 'Operatore'
  AND is_admin = false
  AND permessi ?| ARRAY['bolle.manage', 'bolle.deliver', 'bolle.cancel'];
