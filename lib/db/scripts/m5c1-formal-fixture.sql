-- Solo per ##test M5C1 su PostgreSQL effimero con ledger autentico 44/44.
-- Integra m5b-upgrade-fixture.sql senza modificare dati reali.
BEGIN;

INSERT INTO ruoli (nome, aree, permessi, is_admin)
VALUES
  ('Operatore', '["generale", "sociale"]'::jsonb,
   '["beneficiari.view", "sociale.interventi.view", "richieste_magazzino.create", "bolle.view", "bolle.manage", "bolle.deliver", "bolle.cancel", "permesso.extra.m5c1"]'::jsonb, false),
  ('Operatore Magazzino', '["generale", "magazzino"]'::jsonb,
   '["magazzino.view", "richieste_magazzino.view", "richieste_magazzino.take", "richieste_magazzino.prepare", "bolle.view", "bolle.manage", "bolle.deliver", "bolle.cancel"]'::jsonb, false),
  ('Amministratore', '["amministrazione", "sociale", "magazzino"]'::jsonb,
   '["bolle.view", "bolle.manage", "bolle.deliver", "bolle.cancel"]'::jsonb, true),
  ('SuperAdmin', '["amministrazione", "sociale", "magazzino"]'::jsonb,
   '["bolle.view", "bolle.manage", "bolle.deliver", "bolle.cancel"]'::jsonb, true);

UPDATE ruoli
SET permessi = '["richieste_magazzino.view", "bolle.view", "bolle.manage", "bolle.deliver", "bolle.cancel", "custom.m5c1"]'::jsonb
WHERE nome = 'TEST-M5B Social';

INSERT INTO utenti (username, password_hash, nome, ruolo_id, area_operativa_id, centro_ascolto_id)
SELECT 'test-m5c1-canonical', 'synthetic-not-for-login', 'TEST-M5C1 Canonical', r.id, a.id, c.id
FROM ruoli r
CROSS JOIN aree_operative a
CROSS JOIN centri_di_ascolto c
WHERE r.nome = 'Operatore' AND a.nome = 'TEST-M5B Area A' AND c.nome = 'TEST-M5B Centro A1';

INSERT INTO utenti (username, password_hash, nome, ruolo_id, area_operativa_id)
SELECT 'test-m5c1-warehouse', 'synthetic-not-for-login', 'TEST-M5C1 Warehouse', r.id, a.id
FROM ruoli r CROSS JOIN aree_operative a
WHERE r.nome = 'Operatore Magazzino' AND a.nome = 'TEST-M5B Area A';

INSERT INTO utenti (username, password_hash, nome, ruolo_id)
SELECT 'test-m5c1-admin', 'synthetic-not-for-login', 'TEST-M5C1 Admin', id
FROM ruoli WHERE nome = 'Amministratore';

INSERT INTO utenti (username, password_hash, nome, ruolo_id)
SELECT 'test-m5c1-superadmin', 'synthetic-not-for-login', 'TEST-M5C1 SuperAdmin', id
FROM ruoli WHERE nome = 'SuperAdmin';

COMMIT;
