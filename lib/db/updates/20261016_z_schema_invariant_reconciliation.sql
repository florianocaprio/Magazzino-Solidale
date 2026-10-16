-- M6.7 P2: reconcile historical migrations with a Drizzle-first fresh DB.
-- The historical CREATE TABLE IF NOT EXISTS statements do not add their
-- inline CHECK/FK constraints when Drizzle has already created the table.
-- Restore those existing invariants, without changing business rows or
-- rewriting migrations 1-57. Preserve names, NOT VALID history and indexes.
-- The additional disability CHECK is already required by the Drizzle model,
-- but was absent from the historical ADD COLUMN path (migration 26).
-- Each ADD validates existing rows and aborts atomically on incompatible data.
-- Existing canonical FK RESTRICT actions are preserved; fresh-only weaker
-- NO ACTION aliases may remain redundant, not a replacement for RESTRICT.
DO $reconcile$
DECLARE
  required record;
BEGIN
  FOR required IN SELECT * FROM (VALUES
    ('carichi_magazzino', 'carichi_magazzino_origine_check', $ddl$CHECK (((origine_carico)::text = ANY (ARRAY[('AGEA_SIFEAD'::character varying)::text, ('RACCOLTA_ALIMENTARE'::character varying)::text, ('DONAZIONE'::character varying)::text, ('ACQUISTO'::character varying)::text, ('FORNITORE'::character varying)::text, ('RETTIFICA_INVENTARIO'::character varying)::text, ('SALDO_INIZIALE'::character varying)::text, ('ALTRO'::character varying)::text, ('LEGACY'::character varying)::text])))$ddl$),
    ('carichi_magazzino_righe', 'carichi_magazzino_righe_fondo_check', $ddl$CHECK (((fondo_origine)::text = ANY (ARRAY[('FSE_PLUS'::character varying)::text, ('FONDO_NAZIONALE'::character varying)::text, ('FONDO_NAZIONALE_COFINANZIATO'::character varying)::text, ('NESSUN_FONDO'::character varying)::text])))$ddl$),
    ('corsi_dei_volontari', 'corsi_dei_volontari_versione_check', $ddl$CHECK ((versione > 0))$ddl$),
    ('corsi_volontari_catalogo', 'corsi_volontari_catalogo_versione_check', $ddl$CHECK ((versione > 0))$ddl$),
    ('emissioni_registro_volontari', 'emissioni_registro_volontari_numero_righe_check', $ddl$CHECK ((numero_righe >= 0))$ddl$),
    ('esportazioni_fse', 'esportazioni_fse_counts_check', $ddl$CHECK (((eventi_totali >= 0) AND (righe_totali >= 0) AND (righe_bloccanti >= 0) AND (righe_warning >= 0)))$ddl$),
    ('esportazioni_fse', 'esportazioni_fse_format_check', $ddl$CHECK (((format_code)::text = ANY (ARRAY[('FSE_CANONICAL_AUDIT_XLSX_V1'::character varying)::text, ('SIFEAD_REGISTRO_OSSERVATO_CONTROLLO_V1'::character varying)::text])))$ddl$),
    ('esportazioni_fse_eventi', 'esportazioni_fse_eventi_counts_check', $ddl$CHECK ((((packs IS NULL) OR (packs >= 0)) AND ((meals IS NULL) OR (meals >= 0)) AND ((occasional_people IS NULL) OR (occasional_people >= 0)) AND ((continuous_people IS NULL) OR (continuous_people >= 0))))$ddl$),
    ('esportazioni_fse_indicatori', 'esportazioni_fse_indicatori_hash_check', $ddl$CHECK (((content_hash)::text ~ '^[0-9a-f]{64}$'::text))$ddl$),
    ('esportazioni_fse_saldi', 'esportazioni_fse_saldi_hash_check', $ddl$CHECK (((content_hash)::text ~ '^[0-9a-f]{64}$'::text))$ddl$),
    ('importazioni_agea', 'importazioni_agea_dimensione_bytes_check', $ddl$CHECK (((dimensione_bytes > 0) AND (dimensione_bytes <= 10485760)))$ddl$),
    ('importazioni_agea', 'importazioni_agea_modalita_check', $ddl$CHECK (((modalita)::text = ANY (ARRAY[('PRIMA_ACQUISIZIONE'::character varying)::text, ('AGGIORNAMENTO'::character varying)::text, ('SOLO_ANALISI'::character varying)::text])))$ddl$),
    ('importazioni_agea', 'importazioni_agea_stato_check', $ddl$CHECK (((stato)::text = ANY (ARRAY[('ANALIZZATA'::character varying)::text, ('DA_MAPPARE'::character varying)::text, ('BLOCCATA'::character varying)::text, ('PRONTA'::character varying)::text, ('CONFERMATA'::character varying)::text, ('ANNULLATA'::character varying)::text, ('ERRORE'::character varying)::text])))$ddl$),
    ('importazioni_agea_righe', 'importazioni_agea_righe_content_hash_check', $ddl$CHECK (((content_hash)::text ~ '^[0-9a-f]{64}$'::text))$ddl$),
    ('importazioni_agea_righe', 'importazioni_agea_righe_identity_base_hash_check', $ddl$CHECK (((identity_base_hash)::text ~ '^[0-9a-f]{64}$'::text))$ddl$),
    ('importazioni_agea_righe', 'importazioni_agea_righe_identity_occurrence_check', $ddl$CHECK ((identity_occurrence > 0))$ddl$),
    ('importazioni_agea_righe', 'importazioni_agea_righe_numero_riga_check', $ddl$CHECK ((numero_riga >= 2))$ddl$),
    ('importazioni_volontari', 'importazioni_volontari_counts_check', $ddl$CHECK (((numero_righe >= 0) AND (creati >= 0) AND (aggiornati >= 0) AND (invariati >= 0) AND (esclusi >= 0) AND (errori >= 0)))$ddl$),
    ('importazioni_volontari', 'importazioni_volontari_dimensione_bytes_check', $ddl$CHECK ((dimensione_bytes > 0))$ddl$),
    ('importazioni_volontari_righe', 'importazioni_volontari_righe_hash_riga_check', $ddl$CHECK (((hash_riga)::text ~ '^[0-9a-f]{64}$'::text))$ddl$),
    ('importazioni_volontari_righe', 'importazioni_volontari_righe_stato_riga_check', $ddl$CHECK (((stato_riga)::text = ANY (ARRAY[('NUOVO'::character varying)::text, ('AGGIORNAMENTO_CERTO'::character varying)::text, ('INVARIATO'::character varying)::text, ('POSSIBILE_DUPLICATO'::character varying)::text, ('ERRORE'::character varying)::text, ('DA_VERIFICARE'::character varying)::text])))$ddl$),
    ('interventi_attivita', 'interventi_attivita_descrizione_check', $ddl$CHECK ((length(TRIM(BOTH FROM descrizione)) > 0))$ddl$),
    ('interventi_attivita', 'interventi_attivita_snapshot_check', $ddl$CHECK ((length(TRIM(BOTH FROM tipologia_snapshot)) > 0))$ddl$),
    ('interventi_storico_stati', 'interventi_storico_stato_nuovo_check', $ddl$CHECK (((stato_nuovo)::text = ANY (ARRAY[('da_pianificare'::character varying)::text, ('pianificato'::character varying)::text, ('in_corso'::character varying)::text, ('concluso'::character varying)::text, ('annullato'::character varying)::text, ('mancata_presentazione'::character varying)::text])))$ddl$),
    ('interventi_storico_stati', 'interventi_storico_stato_precedente_check', $ddl$CHECK (((stato_precedente IS NULL) OR ((stato_precedente)::text = ANY (ARRAY[('da_pianificare'::character varying)::text, ('pianificato'::character varying)::text, ('in_corso'::character varying)::text, ('concluso'::character varying)::text, ('annullato'::character varying)::text, ('mancata_presentazione'::character varying)::text]))))$ddl$),
    ('mappature_prodotti_esterni', 'mappature_prodotti_esterni_fonte_check', $ddl$CHECK (((fonte)::text = 'AGEA_SIFEAD'::text))$ddl$),
    ('mappature_prodotti_esterni', 'mappature_prodotti_esterni_versione_check', $ddl$CHECK ((versione > 0))$ddl$),
    ('maps_geocode_cache', 'maps_geocode_cache_status_check', $ddl$CHECK (((status)::text = ANY (ARRAY[('resolved'::character varying)::text, ('not_found'::character varying)::text, ('error'::character varying)::text])))$ddl$),
    ('movimenti_esterni_agea', 'movimenti_esterni_agea_accepted_content_hash_check', $ddl$CHECK (((accepted_content_hash)::text ~ '^[0-9a-f]{64}$'::text))$ddl$),
    ('movimenti_esterni_agea', 'movimenti_esterni_agea_identity_base_hash_check', $ddl$CHECK (((identity_base_hash)::text ~ '^[0-9a-f]{64}$'::text))$ddl$),
    ('movimenti_esterni_agea', 'movimenti_esterni_agea_identity_occurrence_check', $ddl$CHECK ((identity_occurrence > 0))$ddl$),
    ('movimenti_esterni_agea', 'movimenti_esterni_agea_stato_applicazione_check', $ddl$CHECK (((stato_applicazione)::text = ANY (ARRAY[('NON_APPLICABILE_RIFERIMENTO'::character varying)::text, ('DA_APPLICARE'::character varying)::text, ('APPLICATO_INCREMENTALE'::character varying)::text, ('ASSORBITO_SALDO_INIZIALE'::character varying)::text, ('CONFLITTO_CONTENUTO'::character varying)::text])))$ddl$),
    ('operazioni_distribuzione_magazzino', 'operazioni_distribuzione_canale_check', $ddl$CHECK (((canale_operativo)::text = ANY (ARRAY[('PACCHI'::character varying)::text, ('RITIRO_SEDE'::character varying)::text, ('DOMICILIARE'::character varying)::text, ('EMPORIO'::character varying)::text, ('MENSA'::character varying)::text, ('UDS_STRADA'::character varying)::text, ('ALTRO'::character varying)::text])))$ddl$),
    ('qualifiche_dei_volontari', 'qualifiche_dei_volontari_versione_check', $ddl$CHECK ((versione > 0))$ddl$),
    ('qualifiche_volontari_catalogo', 'qualifiche_volontari_catalogo_versione_check', $ddl$CHECK ((versione > 0))$ddl$),
    ('registro_volontari_eventi', 'registro_volontari_eventi_hash_evento_check', $ddl$CHECK (((hash_evento)::text ~ '^[0-9a-f]{64}$'::text))$ddl$),
    ('riconciliazioni_fse', 'riconciliazioni_fse_counts_check', $ddl$CHECK (((totale_righe >= 0) AND (riconciliate >= 0) AND (solo_locali >= 0) AND (solo_agea >= 0) AND (scostamenti >= 0) AND (ambigue >= 0) AND (bloccanti >= 0)))$ddl$),
    ('riconciliazioni_fse', 'riconciliazioni_fse_state_check', $ddl$CHECK (((stato)::text = ANY (ARRAY[('CALCOLATA'::character varying)::text, ('DA_RIVEDERE'::character varying)::text, ('RICONCILIATA'::character varying)::text, ('CHIUSA_CON_SCOSTAMENTI'::character varying)::text, ('ANNULLATA'::character varying)::text])))$ddl$),
    ('riconciliazioni_fse_risoluzioni', 'riconciliazioni_fse_risoluzioni_action_check', $ddl$CHECK (((azione)::text = ANY (ARRAY[('ABBINA'::character varying)::text, ('DISABBINA'::character varying)::text, ('ACCETTA_SCOSTAMENTO'::character varying)::text, ('SEGNALA_DA_CORREGGERE'::character varying)::text, ('RIAPRI'::character varying)::text])))$ddl$),
    ('rilevazioni_monitoraggio_fse', 'rilevazioni_monitoraggio_fse_counts_check', $ddl$CHECK ((((minori_18 IS NULL) OR (minori_18 >= 0)) AND ((giovani_18_29 IS NULL) OR (giovani_18_29 >= 0)) AND ((donne IS NULL) OR (donne >= 0)) AND ((over_65 IS NULL) OR (over_65 >= 0)) AND ((persone_disabilita IS NULL) OR (persone_disabilita >= 0)) AND ((cittadini_paesi_terzi IS NULL) OR (cittadini_paesi_terzi >= 0)) AND ((origine_straniera_minoranze IS NULL) OR (origine_straniera_minoranze >= 0)) AND ((senzatetto_esclusione_abitativa IS NULL) OR (senzatetto_esclusione_abitativa >= 0)) AND ((totale_saltuari IS NULL) OR (totale_saltuari >= 0))))$ddl$),
    ('spese_emporio_storni_righe', 'spese_emporio_storni_righe_quantita_check', $ddl$CHECK ((quantita > (0)::numeric))$ddl$),
    ('esportazioni_fse', 'esportazioni_fse_annullato_da_fkey', $ddl$FOREIGN KEY (annullato_da) REFERENCES utenti(id) ON DELETE RESTRICT$ddl$),
    ('esportazioni_fse', 'esportazioni_fse_creato_da_fkey', $ddl$FOREIGN KEY (creato_da) REFERENCES utenti(id) ON DELETE RESTRICT$ddl$),
    ('esportazioni_fse', 'esportazioni_fse_magazzino_id_fkey', $ddl$FOREIGN KEY (magazzino_id) REFERENCES magazzini(id) ON DELETE RESTRICT$ddl$),
    ('esportazioni_fse', 'esportazioni_fse_marcato_inserito_da_fkey', $ddl$FOREIGN KEY (marcato_inserito_da) REFERENCES utenti(id) ON DELETE RESTRICT$ddl$),
    ('esportazioni_fse_eventi', 'esportazioni_fse_eventi_esportazione_id_fkey', $ddl$FOREIGN KEY (esportazione_id) REFERENCES esportazioni_fse(id) ON DELETE RESTRICT$ddl$),
    ('esportazioni_fse_indicatori', 'esportazioni_fse_indicatori_esportazione_id_fkey', $ddl$FOREIGN KEY (esportazione_id) REFERENCES esportazioni_fse(id) ON DELETE RESTRICT$ddl$),
    ('esportazioni_fse_indicatori', 'esportazioni_fse_indicatori_rilevazione_id_fkey', $ddl$FOREIGN KEY (rilevazione_id) REFERENCES rilevazioni_monitoraggio_fse(id) ON DELETE RESTRICT$ddl$),
    ('esportazioni_fse_righe', 'esportazioni_fse_righe_esportazione_evento_id_fkey', $ddl$FOREIGN KEY (esportazione_evento_id) REFERENCES esportazioni_fse_eventi(id) ON DELETE RESTRICT$ddl$),
    ('esportazioni_fse_righe', 'esportazioni_fse_righe_lot_id_fkey', $ddl$FOREIGN KEY (lot_id) REFERENCES lotti(id) ON DELETE RESTRICT$ddl$),
    ('esportazioni_fse_righe', 'esportazioni_fse_righe_movimento_id_fkey', $ddl$FOREIGN KEY (movimento_id) REFERENCES movimenti(id) ON DELETE RESTRICT$ddl$),
    ('esportazioni_fse_righe', 'esportazioni_fse_righe_movimento_origine_id_fkey', $ddl$FOREIGN KEY (movimento_origine_id) REFERENCES movimenti(id) ON DELETE RESTRICT$ddl$),
    ('esportazioni_fse_righe', 'esportazioni_fse_righe_product_id_fkey', $ddl$FOREIGN KEY (product_id) REFERENCES prodotti(id) ON DELETE RESTRICT$ddl$),
    ('esportazioni_fse_saldi', 'esportazioni_fse_saldi_esportazione_id_fkey', $ddl$FOREIGN KEY (esportazione_id) REFERENCES esportazioni_fse(id) ON DELETE RESTRICT$ddl$),
    ('esportazioni_fse_saldi', 'esportazioni_fse_saldi_lotto_id_fkey', $ddl$FOREIGN KEY (lotto_id) REFERENCES lotti(id) ON DELETE RESTRICT$ddl$),
    ('esportazioni_fse_saldi', 'esportazioni_fse_saldi_magazzino_id_fkey', $ddl$FOREIGN KEY (magazzino_id) REFERENCES magazzini(id) ON DELETE RESTRICT$ddl$),
    ('esportazioni_fse_saldi', 'esportazioni_fse_saldi_prodotto_id_fkey', $ddl$FOREIGN KEY (prodotto_id) REFERENCES prodotti(id) ON DELETE RESTRICT$ddl$),
    ('movimenti_esterni_agea', 'movimenti_esterni_agea_accepted_import_row_id_fkey', $ddl$FOREIGN KEY (accepted_import_row_id) REFERENCES importazioni_agea_righe(id)$ddl$),
    ('riconciliazioni_fse', 'riconciliazioni_fse_annullato_da_fkey', $ddl$FOREIGN KEY (annullato_da) REFERENCES utenti(id) ON DELETE RESTRICT$ddl$),
    ('riconciliazioni_fse', 'riconciliazioni_fse_chiuso_da_fkey', $ddl$FOREIGN KEY (chiuso_da) REFERENCES utenti(id) ON DELETE RESTRICT$ddl$),
    ('riconciliazioni_fse', 'riconciliazioni_fse_creato_da_fkey', $ddl$FOREIGN KEY (creato_da) REFERENCES utenti(id) ON DELETE RESTRICT$ddl$),
    ('riconciliazioni_fse', 'riconciliazioni_fse_importazione_agea_id_fkey', $ddl$FOREIGN KEY (importazione_agea_id) REFERENCES importazioni_agea(id) ON DELETE RESTRICT$ddl$),
    ('riconciliazioni_fse', 'riconciliazioni_fse_importazione_agea_precedente_id_fkey', $ddl$FOREIGN KEY (importazione_agea_precedente_id) REFERENCES importazioni_agea(id) ON DELETE RESTRICT$ddl$),
    ('riconciliazioni_fse', 'riconciliazioni_fse_magazzino_id_fkey', $ddl$FOREIGN KEY (magazzino_id) REFERENCES magazzini(id) ON DELETE RESTRICT$ddl$),
    ('riconciliazioni_fse', 'riconciliazioni_fse_ricalcolato_da_fkey', $ddl$FOREIGN KEY (ricalcolato_da) REFERENCES utenti(id) ON DELETE RESTRICT$ddl$),
    ('riconciliazioni_fse_righe', 'riconciliazioni_fse_righe_importazione_agea_riga_id_fkey', $ddl$FOREIGN KEY (importazione_agea_riga_id) REFERENCES importazioni_agea_righe(id) ON DELETE RESTRICT$ddl$),
    ('riconciliazioni_fse_righe', 'riconciliazioni_fse_righe_movimento_id_fkey', $ddl$FOREIGN KEY (movimento_id) REFERENCES movimenti(id) ON DELETE RESTRICT$ddl$),
    ('riconciliazioni_fse_righe', 'riconciliazioni_fse_righe_operazione_distribuzione_id_fkey', $ddl$FOREIGN KEY (operazione_distribuzione_id) REFERENCES operazioni_distribuzione_magazzino(id) ON DELETE RESTRICT$ddl$),
    ('riconciliazioni_fse_righe', 'riconciliazioni_fse_righe_product_id_external_fkey', $ddl$FOREIGN KEY (product_id_external) REFERENCES prodotti(id) ON DELETE RESTRICT$ddl$),
    ('riconciliazioni_fse_righe', 'riconciliazioni_fse_righe_product_id_local_fkey', $ddl$FOREIGN KEY (product_id_local) REFERENCES prodotti(id) ON DELETE RESTRICT$ddl$),
    ('riconciliazioni_fse_righe', 'riconciliazioni_fse_righe_riconciliazione_id_fkey', $ddl$FOREIGN KEY (riconciliazione_id) REFERENCES riconciliazioni_fse(id) ON DELETE RESTRICT$ddl$),
    ('riconciliazioni_fse_risoluzioni', 'riconciliazioni_fse_risoluzion_target_importazione_riga_id_fkey', $ddl$FOREIGN KEY (target_importazione_riga_id) REFERENCES importazioni_agea_righe(id) ON DELETE RESTRICT$ddl$),
    ('riconciliazioni_fse_risoluzioni', 'riconciliazioni_fse_risoluzioni_creato_da_fkey', $ddl$FOREIGN KEY (creato_da) REFERENCES utenti(id) ON DELETE RESTRICT$ddl$),
    ('riconciliazioni_fse_risoluzioni', 'riconciliazioni_fse_risoluzioni_riconciliazione_id_fkey', $ddl$FOREIGN KEY (riconciliazione_id) REFERENCES riconciliazioni_fse(id) ON DELETE RESTRICT$ddl$),
    ('riconciliazioni_fse_risoluzioni', 'riconciliazioni_fse_risoluzioni_riconciliazione_riga_id_fkey', $ddl$FOREIGN KEY (riconciliazione_riga_id) REFERENCES riconciliazioni_fse_righe(id) ON DELETE RESTRICT$ddl$),
    ('riconciliazioni_fse_risoluzioni', 'riconciliazioni_fse_risoluzioni_target_movimento_id_fkey', $ddl$FOREIGN KEY (target_movimento_id) REFERENCES movimenti(id) ON DELETE RESTRICT$ddl$),
    ('rilevazioni_monitoraggio_fse', 'rilevazioni_monitoraggio_fse_aggiornato_da_fkey', $ddl$FOREIGN KEY (aggiornato_da) REFERENCES utenti(id) ON DELETE RESTRICT$ddl$),
    ('rilevazioni_monitoraggio_fse', 'rilevazioni_monitoraggio_fse_creato_da_fkey', $ddl$FOREIGN KEY (creato_da) REFERENCES utenti(id) ON DELETE RESTRICT$ddl$),
    ('rilevazioni_monitoraggio_fse', 'rilevazioni_monitoraggio_fse_magazzino_id_fkey', $ddl$FOREIGN KEY (magazzino_id) REFERENCES magazzini(id) ON DELETE RESTRICT$ddl$),
    ('rilevazioni_monitoraggio_fse', 'rilevazioni_monitoraggio_fse_operazione_distribuzione_id_fkey', $ddl$FOREIGN KEY (operazione_distribuzione_id) REFERENCES operazioni_distribuzione_magazzino(id) ON DELETE RESTRICT$ddl$),
    ('fse_fascicoli_sociali', 'fse_fascicoli_sociali_disabilita_nonnegative_check', $ddl$CHECK (persone_disabilita IS NULL OR persone_disabilita >= 0)$ddl$)
  ) AS rules(table_name, constraint_name, definition)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', required.table_name)::regclass
        AND conname = required.constraint_name
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s',
        required.table_name, required.constraint_name, required.definition);
    END IF;
  END LOOP;
END
$reconcile$;
