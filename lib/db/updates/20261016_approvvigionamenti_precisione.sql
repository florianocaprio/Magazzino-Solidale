-- Preserve historical values exactly; never infer fractions already lost.
-- Append-only change: same eight integer digits, six inventory decimals.
ALTER TABLE approvvigionamento_righe
  ALTER COLUMN quantita_richiesta TYPE numeric(14,6),
  ALTER COLUMN quantita_ricevuta TYPE numeric(14,6);
