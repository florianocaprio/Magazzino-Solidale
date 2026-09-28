-- Execute only on the verified M5B disposable upgrade database.
-- Every inserted row is rolled back; expected PostgreSQL errors are asserted.
BEGIN;
DO $$
DECLARE
  request_id integer;
  other_request_id integer;
  user_id integer;
  bolla_id integer;
  transfer_id integer;
  intervention_id integer;
  rejected boolean;
BEGIN
  SELECT id INTO STRICT request_id FROM richieste_magazzino WHERE codice = 'TEST-M5B-R-TAKEN';
  SELECT id INTO STRICT other_request_id FROM richieste_magazzino WHERE codice = 'TEST-M5B-R-SENT';
  SELECT id INTO STRICT user_id FROM utenti WHERE username = 'test-m5b-warehouse';
  SELECT id INTO STRICT bolla_id FROM bolle WHERE numero_bolla = 'TEST-M5B-BOLLA-LEGACY';
  SELECT id INTO STRICT transfer_id FROM trasferimenti WHERE codice = 'TEST-M5B-TR';
  SELECT id INTO STRICT intervention_id FROM interventi WHERE tipo_intervento = 'TEST-M5B in corso';

  INSERT INTO richieste_magazzino_documenti
    (richiesta_id, tipo_documento, bolla_id, creato_da)
  VALUES (request_id, 'bolla', bolla_id, user_id);

  rejected := false;
  BEGIN
    INSERT INTO richieste_magazzino_documenti
      (richiesta_id, tipo_documento, trasferimento_id, creato_da)
    VALUES (request_id, 'trasferimento', transfer_id, user_id);
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'REL-04: second current link was accepted'; END IF;
  RAISE NOTICE 'REL-04 current uniqueness: PASS';

  rejected := false;
  BEGIN
    INSERT INTO richieste_magazzino_documenti
      (richiesta_id, tipo_documento, bolla_id, corrente, creato_da,
       cessato_da, cessato_at, evento_cessazione, motivo_cessazione)
    VALUES (other_request_id, 'bolla', bolla_id, false, user_id,
      user_id, now(), 'annullamento_m4', 'synthetic test');
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'REL-05: historical document was reused'; END IF;
  RAISE NOTICE 'REL-05 historical document uniqueness: PASS';

  rejected := false;
  BEGIN
    INSERT INTO richieste_magazzino_documenti
      (richiesta_id, tipo_documento, bolla_id, trasferimento_id, creato_da)
    VALUES (other_request_id, 'bolla', bolla_id, transfer_id, user_id);
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'REL-06: non-exclusive document was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO richieste_magazzino_documenti
      (richiesta_id, tipo_documento, creato_da)
    VALUES (other_request_id, 'bolla', user_id);
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'REL-06: document without FK was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO richieste_magazzino_documenti
      (richiesta_id, tipo_documento, bolla_id, creato_da)
    VALUES (other_request_id, 'bolla', 2147483647, user_id);
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'REL-06: invalid FK was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO richieste_magazzino_documenti
      (richiesta_id, tipo_documento, trasferimento_id, corrente, creato_da)
    VALUES (other_request_id, 'trasferimento', transfer_id, false, user_id);
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'REL-06: incomplete historical state was accepted'; END IF;
  RAISE NOTICE 'REL-06 type, FK and history CHECK: PASS';

  UPDATE richieste_magazzino_documenti SET
    corrente = false, cessato_da = user_id, cessato_at = now(),
    evento_cessazione = 'annullamento_m4', motivo_cessazione = 'synthetic test'
  WHERE richiesta_id = request_id;
  INSERT INTO richieste_magazzino_documenti
    (richiesta_id, tipo_documento, trasferimento_id, creato_da)
  VALUES (request_id, 'trasferimento', transfer_id, user_id);
  IF (SELECT count(*) FROM richieste_magazzino_documenti WHERE richiesta_id = request_id) <> 2
    THEN RAISE EXCEPTION 'REL-07: historical link did not coexist with replacement';
  END IF;
  RAISE NOTICE 'REL-07 historical plus current: PASS';

  rejected := false;
  BEGIN
    DELETE FROM bolle WHERE id = bolla_id;
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'REL-08: linked document was deleted'; END IF;
  RAISE NOTICE 'REL-08 document FK RESTRICT: PASS';

  INSERT INTO interventi_deleghe_m4
    (intervento_id, prima_richiesta_id, delegato_da)
  VALUES (intervention_id, request_id, user_id);
  rejected := false;
  BEGIN
    INSERT INTO interventi_deleghe_m4
      (intervento_id, prima_richiesta_id, delegato_da)
    VALUES (intervention_id, other_request_id, user_id);
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'LEG-04: duplicate permanent delegation was accepted'; END IF;
  RAISE NOTICE 'LEG-04 permanent delegation uniqueness: PASS';
END $$;
ROLLBACK;
