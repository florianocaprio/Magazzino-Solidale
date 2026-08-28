-- Cache additiva per il geocoding MAPS; non contiene dati anagrafici o sociali.
CREATE TABLE IF NOT EXISTS maps_geocode_cache (
  id serial PRIMARY KEY,
  normalized_address varchar(500) NOT NULL,
  original_address varchar(500) NOT NULL,
  latitude numeric(10,7),
  longitude numeric(10,7),
  provider varchar(80) NOT NULL,
  status varchar(20) NOT NULL,
  last_attempt_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT maps_geocode_cache_status_check CHECK (status IN ('resolved', 'not_found', 'error'))
);
CREATE UNIQUE INDEX IF NOT EXISTS maps_geocode_cache_normalized_address_uidx
  ON maps_geocode_cache (normalized_address);
CREATE INDEX IF NOT EXISTS maps_geocode_cache_status_last_attempt_idx
  ON maps_geocode_cache (status, last_attempt_at);
