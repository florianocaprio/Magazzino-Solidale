-- BUG 17: NULL identifica un Ente globale; un ID reale un Ente territoriale.
-- Nessuna conversione dei dati esistenti, nessuna modifica a ID/FK/documenti.
ALTER TABLE enti_destinatari ALTER COLUMN area_operativa_id DROP NOT NULL;
