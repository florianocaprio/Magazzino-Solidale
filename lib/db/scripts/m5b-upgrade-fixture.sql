-- Synthetic M5A/M4 rows for the disposable 43 -> 44 migration test only.
-- Run with psql -v ON_ERROR_STOP=1 on the verified M5B upgrade database.
BEGIN;

INSERT INTO aree_operative (nome, sigla, codice_matricola)
VALUES ('TEST-M5B Area A', 'TA', 'M5BTA') RETURNING id \gset area_a_
INSERT INTO aree_operative (nome, sigla, codice_matricola)
VALUES ('TEST-M5B Area B', 'TB', 'M5BTB') RETURNING id \gset area_b_
INSERT INTO centri_di_ascolto (nome, area_operativa_id)
VALUES ('TEST-M5B Centro A1', :area_a_id) RETURNING id \gset center_a1_
INSERT INTO centri_di_ascolto (nome, area_operativa_id)
VALUES ('TEST-M5B Centro A2', :area_a_id) RETURNING id \gset center_a2_
INSERT INTO centri_di_ascolto (nome, area_operativa_id)
VALUES ('TEST-M5B Centro B1', :area_b_id) RETURNING id \gset center_b1_
INSERT INTO zone_uds (nome, area_operativa_id)
VALUES ('TEST-M5B Zona A', :area_a_id) RETURNING id \gset zone_a_

INSERT INTO ruoli (nome, aree, permessi)
VALUES ('TEST-M5B Social', '["sociale"]'::jsonb, '["richieste_magazzino.view"]'::jsonb)
RETURNING id \gset role_social_
INSERT INTO ruoli (nome, aree, permessi)
VALUES ('TEST-M5B Warehouse', '["magazzino"]'::jsonb, '["richieste_magazzino.view"]'::jsonb)
RETURNING id \gset role_warehouse_
INSERT INTO ruoli (nome, aree, permessi)
VALUES ('TEST-M5B Custom', '["magazzino"]'::jsonb, '["giacenze.view"]'::jsonb)
RETURNING id \gset role_custom_
INSERT INTO utenti (username, password_hash, nome, ruolo_id, centro_ascolto_id, area_operativa_id)
VALUES ('test-m5b-social', 'synthetic-not-for-login', 'TEST-M5B Social', :role_social_id, :center_a1_id, :area_a_id)
RETURNING id \gset user_social_
INSERT INTO utenti (username, password_hash, nome, ruolo_id, area_operativa_id)
VALUES ('test-m5b-warehouse', 'synthetic-not-for-login', 'TEST-M5B Warehouse', :role_warehouse_id, :area_a_id)
RETURNING id \gset user_warehouse_
INSERT INTO utenti (username, password_hash, nome, ruolo_id, area_operativa_id)
VALUES ('test-m5b-custom', 'synthetic-not-for-login', 'TEST-M5B Custom', :role_custom_id, :area_b_id)
RETURNING id \gset user_custom_

INSERT INTO magazzini (codice, nome, area_operativa_id, centro_ascolto_id)
VALUES ('TEST-M5B-MA', 'TEST-M5B Deposito A1', :area_a_id, :center_a1_id)
RETURNING id \gset warehouse_a_
INSERT INTO magazzini (codice, nome, area_operativa_id, centro_ascolto_id)
VALUES ('TEST-M5B-MT', 'TEST-M5B Deposito A2', :area_a_id, :center_a2_id)
RETURNING id \gset warehouse_t_
INSERT INTO magazzini (codice, nome, area_operativa_id, centro_ascolto_id)
VALUES ('TEST-M5B-MB', 'TEST-M5B Deposito B1', :area_b_id, :center_b1_id)
RETURNING id \gset warehouse_b_
INSERT INTO prodotti (codice, nome, tipo_prodotto, unita_misura)
VALUES ('TEST-M5B-P', 'TEST-M5B Pasta', 'alimentare', 'pz') RETURNING id \gset product_
INSERT INTO beneficiari (codice, cognome, nome, centro_ascolto_id, area_operativa_id, num_componenti)
VALUES ('TEST-M5B-B1', 'Test', 'Ada', :center_a1_id, :area_a_id, 4)
RETURNING id \gset beneficiary_
INSERT INTO beneficiari (codice, cognome, nome, centro_ascolto_id, area_operativa_id, attivo)
VALUES ('TEST-M5B-B2', 'Test', 'Inattiva', :center_a2_id, :area_a_id, false)
RETURNING id \gset beneficiary_inactive_
INSERT INTO enti_destinatari (denominazione, indirizzo, area_operativa_id)
VALUES ('TEST-M5B Ente', 'Via sintetica 1', :area_a_id) RETURNING id \gset entity_

INSERT INTO interventi (beneficiario_id, operatore_id, data_intervento, tipo_intervento, stato, ambito,
  area_operativa_id_snapshot, centro_ascolto_id_snapshot)
VALUES (:beneficiary_id, :user_social_id, DATE '2026-09-26', 'TEST-M5B in corso', 'in_corso', 'sociale', :area_a_id, :center_a1_id)
RETURNING id \gset intervention_open_
INSERT INTO interventi (beneficiario_id, operatore_id, data_intervento, tipo_intervento, stato, ambito,
  area_operativa_id_snapshot, centro_ascolto_id_snapshot)
VALUES (:beneficiary_id, :user_social_id, DATE '2026-09-25', 'TEST-M5B concluso', 'concluso', 'sociale', :area_a_id, :center_a1_id)
RETURNING id \gset intervention_closed_
INSERT INTO interventi (beneficiario_id, operatore_id, data_intervento, tipo_intervento, stato, ambito,
  area_operativa_id_snapshot, centro_ascolto_id_snapshot)
VALUES (:beneficiary_id, :user_social_id, DATE '2026-09-24', 'TEST-M5B legacy erogato', 'concluso', 'sociale', :area_a_id, :center_a1_id)
RETURNING id \gset intervention_legacy_
INSERT INTO interventi (beneficiario_id, operatore_id, data_intervento, tipo_intervento, stato, ambito,
  area_operativa_id_snapshot, centro_ascolto_id_snapshot, zona_uds_id_snapshot)
VALUES (:beneficiary_id, :user_social_id, DATE '2026-09-23', 'TEST-M5B UDS', 'concluso', 'uds', :area_a_id, :center_a1_id, :zone_a_id)
RETURNING id \gset intervention_uds_
INSERT INTO interventi_materiali (intervento_id, prodotto_id, descrizione_snapshot, unita_misura_snapshot,
  quantita_prevista, quantita_consegnata, magazzino_id)
VALUES (:intervention_open_id, :product_id, 'TEST-M5B Pasta', 'pz', 2.000000, 0.000000, :warehouse_a_id);
INSERT INTO interventi_materiali (intervento_id, prodotto_id, descrizione_snapshot, unita_misura_snapshot,
  quantita_prevista, quantita_consegnata, magazzino_id)
VALUES (:intervention_legacy_id, :product_id, 'TEST-M5B Pasta', 'pz', 2.000000, 2.000000, :warehouse_a_id);

INSERT INTO lotti (prodotto_id, data_carico, quantita_caricata, quantita_residua, magazzino_id, codice_lotto)
VALUES (:product_id, DATE '2026-09-24', 10.000000, 8.000000, :warehouse_a_id, 'TEST-M5B-LOT-A')
RETURNING id \gset lot_
INSERT INTO movimenti (tipo_movimento, tipo_dettaglio, data_movimento, magazzino_id, prodotto_id,
  lotto_id, quantita, unita_misura, operatore_id)
VALUES ('carico', 'entrata', DATE '2026-09-24', :warehouse_a_id, :product_id,
  :lot_id, 10.000000, 'pz', :user_warehouse_id);
INSERT INTO operazioni_distribuzione_magazzino (magazzino_id, data_distribuzione, canale_operativo,
  dominio_origine, entita_origine_tipo, entita_origine_id, area_operativa_id_snapshot,
  centro_ascolto_id_snapshot, territorio_classificazione, numero_documento, creato_da)
VALUES (:warehouse_a_id, DATE '2026-09-24', 'ALTRO', 'SOCIALE', 'intervento_materiali_legacy',
  :intervention_legacy_id, :area_a_id, :center_a1_id, 'attribuito', 'TEST-M5B-INT', :user_social_id)
RETURNING id \gset distribution_
INSERT INTO movimenti (tipo_movimento, tipo_dettaglio, data_movimento, magazzino_id, prodotto_id,
  lotto_id, quantita, unita_misura, operatore_id, dominio_origine, entita_origine_tipo,
  entita_origine_id, operazione_distribuzione_id)
VALUES ('scarico', 'uscita', DATE '2026-09-24', :warehouse_a_id, :product_id,
  :lot_id, 2.000000, 'pz', :user_social_id, 'SOCIALE', 'intervento_materiali_legacy',
  :intervention_legacy_id, :distribution_id);

INSERT INTO bolle (numero_bolla, data_bolla, beneficiario_id, magazzino_id, stato,
  area_operativa_id_snapshot, centro_ascolto_id_snapshot, destinatario_nome_snapshot, destinatario_snapshot_congelato)
VALUES ('TEST-M5B-BOLLA-LEGACY', DATE '2026-09-25', :beneficiary_id, :warehouse_a_id,
  'confermato', :area_a_id, :center_a1_id, 'Ada Test', true)
RETURNING id \gset bolla_
INSERT INTO bolla_righe (bolla_id, prodotto_id, lotto_id, quantita, unita_misura)
VALUES (:bolla_id, :product_id, :lot_id, 2.000000, 'pz') RETURNING id \gset bolla_row_
INSERT INTO prenotazioni_magazzino (bolla_id, riga_bolla_id, prodotto_id, lotto_id, magazzino_id, quantita)
VALUES (:bolla_id, :bolla_row_id, :product_id, :lot_id, :warehouse_a_id, 2.000000);
INSERT INTO consegne (codice, beneficiario_id, tipo_consegna, data_prevista, magazzino_id,
  area_operativa_id_snapshot, centro_ascolto_id_snapshot, stato)
VALUES ('TEST-M5B-CONS', :beneficiary_id, 'domicilio', DATE '2026-09-27', :warehouse_a_id,
  :area_a_id, :center_a1_id, 'pianificata');
INSERT INTO trasferimenti (codice, magazzino_origine_id, magazzino_destino_id, data_richiesta, stato, operatore_id)
VALUES ('TEST-M5B-TR', :warehouse_a_id, :warehouse_t_id, DATE '2026-09-25', 'richiesto', :user_warehouse_id)
RETURNING id \gset transfer_
INSERT INTO trasferimento_righe (trasferimento_id, prodotto_id, lotto_id, quantita, unita_misura)
VALUES (:transfer_id, :product_id, :lot_id, 1.000000, 'pz');

INSERT INTO richieste_magazzino (codice, tipo_destinatario, beneficiario_id, area_operativa_id,
  centro_ascolto_id, sorgente, destinatario_nome_snapshot, area_nome_snapshot, centro_nome_snapshot,
  bisogno, inviato_da)
VALUES ('TEST-M5B-R-SENT', 'beneficiario', :beneficiary_id, :area_a_id, :center_a1_id,
  'beneficiario', 'Ada Test', 'TEST-M5B Area A', 'TEST-M5B Centro A1', 'Bisogno sintetico inviato', :user_social_id);
INSERT INTO richieste_magazzino (codice, tipo_destinatario, beneficiario_id, area_operativa_id,
  centro_ascolto_id, sorgente, intervento_id, destinatario_nome_snapshot, area_nome_snapshot,
  centro_nome_snapshot, bisogno, stato, versione, inviato_da, preso_in_carico_da,
  preso_in_carico_codice_snapshot, preso_in_carico_at)
VALUES ('TEST-M5B-R-TAKEN', 'beneficiario', :beneficiary_id, :area_a_id, :center_a1_id,
  'intervento_sociale', :intervention_open_id, 'Ada Test', 'TEST-M5B Area A',
  'TEST-M5B Centro A1', 'Bisogno sintetico preso', 'presa_in_carico', 2,
  :user_social_id, :user_warehouse_id, 'test-m5b-warehouse', now());
INSERT INTO richieste_magazzino (codice, tipo_destinatario, beneficiario_id, area_operativa_id,
  centro_ascolto_id, sorgente, destinatario_nome_snapshot, area_nome_snapshot, centro_nome_snapshot,
  bisogno, stato, versione, inviato_da, annullato_da, annullato_at, motivo_annullamento)
VALUES ('TEST-M5B-R-CANCEL', 'beneficiario', :beneficiary_id, :area_a_id, :center_a1_id,
  'beneficiario', 'Ada Test', 'TEST-M5B Area A', 'TEST-M5B Centro A1',
  'Bisogno sintetico annullato', 'annullata', 2, :user_social_id,
  :user_social_id, now(), 'Fixture annullata');
INSERT INTO richieste_magazzino (codice, tipo_destinatario, ente_destinatario_id, area_operativa_id,
  sorgente, destinatario_nome_snapshot, area_nome_snapshot, bisogno, stato, versione, inviato_da,
  preso_in_carico_da, preso_in_carico_codice_snapshot, preso_in_carico_at)
VALUES ('TEST-M5B-R-ENTE', 'ente', :entity_id, :area_a_id, 'operativa', 'TEST-M5B Ente',
  'TEST-M5B Area A', 'Bisogno Ente sintetico', 'presa_in_carico', 2, :user_warehouse_id,
  :user_warehouse_id, 'test-m5b-warehouse', now());
INSERT INTO richieste_magazzino (codice, tipo_destinatario, magazzino_destinatario_id, area_operativa_id,
  sorgente, destinatario_nome_snapshot, area_nome_snapshot, bisogno, stato, versione, inviato_da,
  preso_in_carico_da, preso_in_carico_codice_snapshot, preso_in_carico_at)
VALUES ('TEST-M5B-R-TRANSFER', 'magazzino', :warehouse_t_id, :area_a_id, 'operativa',
  'TEST-M5B Deposito A2', 'TEST-M5B Area A', 'Bisogno Trasferimento sintetico',
  'presa_in_carico', 2, :user_warehouse_id, :user_warehouse_id, 'test-m5b-warehouse', now());

COMMIT;
