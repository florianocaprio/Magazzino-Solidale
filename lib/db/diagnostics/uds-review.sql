-- Diagnostica read-only Review 2.0 UDS.
-- Restituisce esclusivamente conteggi e distribuzioni aggregate, senza PII.

SELECT 'zone_attive_duplicate_area_nome_normalizzato' AS controllo, count(*)::bigint AS valore
FROM (
  SELECT area_operativa_id, lower(btrim(nome))
  FROM public.zone_uds
  WHERE attivo = true
  GROUP BY area_operativa_id, lower(btrim(nome))
  HAVING count(*) > 1
) anomalie
UNION ALL
SELECT 'zone_senza_area_valida', count(*)::bigint
FROM public.zone_uds z
LEFT JOIN public.aree_operative a ON a.id = z.area_operativa_id
WHERE a.id IS NULL
UNION ALL
SELECT 'zone_inattive_con_beneficiari', count(*)::bigint
FROM public.zone_uds z
WHERE z.attivo = false
  AND EXISTS (SELECT 1 FROM public.beneficiari b WHERE b.zona_uds_id = z.id)
UNION ALL
SELECT 'zone_inattive_con_utenti', count(*)::bigint
FROM public.zone_uds z
WHERE z.attivo = false
  AND EXISTS (SELECT 1 FROM public.utenti u WHERE u.zona_uds_id = z.id);

SELECT area_operativa_id, attivo, count(*)::bigint AS zone
FROM public.zone_uds
GROUP BY area_operativa_id, attivo
ORDER BY area_operativa_id, attivo;

SELECT 'beneficiari_uds_senza_area' AS controllo, count(*)::bigint AS valore
FROM public.beneficiari WHERE uds = true AND area_operativa_id IS NULL
UNION ALL
SELECT 'beneficiari_zona_senza_area', count(*)::bigint
FROM public.beneficiari WHERE zona_uds_id IS NOT NULL AND area_operativa_id IS NULL
UNION ALL
SELECT 'beneficiari_zona_area_incoerente', count(*)::bigint
FROM public.beneficiari b
JOIN public.zone_uds z ON z.id = b.zona_uds_id
WHERE b.area_operativa_id IS DISTINCT FROM z.area_operativa_id
UNION ALL
SELECT 'beneficiari_zona_con_uds_false', count(*)::bigint
FROM public.beneficiari WHERE zona_uds_id IS NOT NULL AND uds = false
UNION ALL
SELECT 'beneficiari_uds_in_zona_inattiva', count(*)::bigint
FROM public.beneficiari b
JOIN public.zone_uds z ON z.id = b.zona_uds_id
WHERE b.uds = true AND z.attivo = false
UNION ALL
SELECT 'beneficiari_uds_senza_zona_informativo', count(*)::bigint
FROM public.beneficiari WHERE uds = true AND zona_uds_id IS NULL;

SELECT 'utenti_zona_senza_area' AS controllo, count(*)::bigint AS valore
FROM public.utenti WHERE zona_uds_id IS NOT NULL AND area_operativa_id IS NULL
UNION ALL
SELECT 'utenti_zona_area_incoerente', count(*)::bigint
FROM public.utenti u
JOIN public.zone_uds z ON z.id = u.zona_uds_id
WHERE u.area_operativa_id IS DISTINCT FROM z.area_operativa_id
UNION ALL
SELECT 'utenti_in_zona_inattiva', count(*)::bigint
FROM public.utenti u
JOIN public.zone_uds z ON z.id = u.zona_uds_id
WHERE z.attivo = false;

WITH interventi_diagnostica AS (
  SELECT
    i.*,
    nullif(to_jsonb(i)->>'area_operativa_id_snapshot', '')::integer AS area_snapshot,
    nullif(to_jsonb(i)->>'zona_uds_id_snapshot', '')::integer AS zona_snapshot
  FROM public.interventi i
)
SELECT 'interventi_uds_senza_area_snapshot' AS controllo, count(*)::bigint AS valore
FROM interventi_diagnostica WHERE ambito = 'uds' AND area_snapshot IS NULL
UNION ALL
SELECT 'interventi_uds_zona_area_snapshot_incoerente', count(*)::bigint
FROM interventi_diagnostica i
JOIN public.zone_uds z ON z.id = i.zona_snapshot
WHERE i.ambito = 'uds' AND z.area_operativa_id IS DISTINCT FROM i.area_snapshot
UNION ALL
SELECT 'interventi_ambito_null_con_note_uds', count(*)::bigint
FROM interventi_diagnostica WHERE ambito IS NULL AND note_uds IS NOT NULL
UNION ALL
SELECT 'interventi_ambito_null_beneficiario_oggi_uds', count(*)::bigint
FROM interventi_diagnostica i
JOIN public.beneficiari b ON b.id = i.beneficiario_id
WHERE i.ambito IS NULL AND b.uds = true
UNION ALL
SELECT 'interventi_uds_senza_data_intervento', count(*)::bigint
FROM interventi_diagnostica WHERE ambito = 'uds' AND data_intervento IS NULL
UNION ALL
SELECT 'interventi_uds_timestamp_ordine_incoerente', count(*)::bigint
FROM interventi_diagnostica
WHERE ambito = 'uds'
  AND data_ora_avvio IS NOT NULL
  AND data_ora_conclusione IS NOT NULL
  AND data_ora_conclusione < data_ora_avvio
UNION ALL
SELECT 'interventi_uds_legacy_non_classificabili_senza_interpretazione', count(*)::bigint
FROM interventi_diagnostica WHERE ambito = 'uds' AND area_snapshot IS NULL;

WITH interventi_diagnostica AS (
  SELECT
    ambito,
    nullif(to_jsonb(i)->>'area_operativa_id_snapshot', '')::integer AS area_snapshot,
    nullif(to_jsonb(i)->>'zona_uds_id_snapshot', '')::integer AS zona_snapshot
  FROM public.interventi i
)
SELECT
  coalesce(area_snapshot::text, 'senza_area_snapshot') AS area_snapshot,
  coalesce(zona_snapshot::text, 'senza_zona_snapshot') AS zona_snapshot,
  count(*)::bigint AS interventi_uds
FROM interventi_diagnostica
WHERE ambito = 'uds'
GROUP BY area_snapshot, zona_snapshot
ORDER BY area_snapshot NULLS FIRST, zona_snapshot NULLS FIRST;

SELECT 'bisogni_pianificati_senza_data' AS controllo, count(*)::bigint AS valore
FROM public.bisogni_pianificati
WHERE stato = 'pianificato' AND data_prevista IS NULL
UNION ALL
SELECT 'bisogni_completati_senza_data_completamento', count(*)::bigint
FROM public.bisogni_pianificati
WHERE stato = 'completato' AND data_completamento IS NULL
UNION ALL
SELECT 'bisogni_non_completati_con_data_completamento', count(*)::bigint
FROM public.bisogni_pianificati
WHERE stato <> 'completato' AND data_completamento IS NOT NULL
UNION ALL
SELECT 'bisogni_orfani', count(*)::bigint
FROM public.bisogni_pianificati b
LEFT JOIN public.interventi i ON i.id = b.intervento_id
WHERE i.id IS NULL;

SELECT
  r.is_admin,
  count(*)::bigint AS ruoli_uds,
  count(*) FILTER (
    WHERE r.permessi @> '[
      "uds.directory.view",
      "uds.interventi.view",
      "uds.interventi.create",
      "uds.interventi.update",
      "uds.interventi.note",
      "uds.bisogni.manage",
      "uds.reports.view"
    ]'::jsonb
  )::bigint AS ruoli_con_set_uds_completo,
  coalesce(sum((SELECT count(*) FROM public.utenti u WHERE u.ruolo_id = r.id)), 0)::bigint AS utenti_associati
FROM public.ruoli r
WHERE r.aree @> '["uds"]'::jsonb
GROUP BY r.is_admin
ORDER BY r.is_admin;

SELECT
  c.conrelid::regclass::text AS tabella,
  c.conname AS nome_constraint,
  c.contype AS tipo,
  c.convalidated AS validato
FROM pg_constraint c
WHERE c.conname = ANY(ARRAY[
  'beneficiari_zona_richiede_area_check',
  'beneficiari_zona_area_fk',
  'utenti_zona_richiede_area_check',
  'utenti_zona_area_fk',
  'interventi_uds_area_snapshot_check',
  'interventi_uds_zona_area_snapshot_fk'
])
ORDER BY tabella, nome_constraint;
