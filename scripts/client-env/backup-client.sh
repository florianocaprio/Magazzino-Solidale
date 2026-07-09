#!/usr/bin/env bash
set -euo pipefail

CLIENTS_ROOT="${CLIENTS_ROOT:-/opt/magazzino-clienti}"
DATA_ROOT="${DATA_ROOT:-/data/magazzino-clienti}"
CLIENT_SLUG=""
OUTPUT_FILE=""
DRY_RUN=false
ALLOW_AIM=false

usage() {
  cat <<'EOF'
Uso:
  scripts/client-env/backup-client.sh --slug cliente-x

Opzioni:
  --slug SLUG             Slug cliente.
  --output FILE           Path dump opzionale. Default: backup timestamp in /data.
  --clients-root DIR      Root stack clienti. Default: /opt/magazzino-clienti
  --data-root DIR         Root dati persistenti. Default: /data/magazzino-clienti
  --dry-run               Mostra cosa verrebbe eseguito.
  --allow-aim             Permette esplicitamente lo slug angeli-in-moto/aim.
  --help                  Mostra questo aiuto.
EOF
}

fail() {
  printf 'Errore: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '%s\n' "$*"
}

is_valid_slug() {
  [[ "$1" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]
}

is_protected_slug() {
  [[ "$1" == "angeli-in-moto" || "$1" == "aim" ]]
}

run_client() {
  if [[ "${DRY_RUN}" == true ]]; then
    printf '[dry-run] cd %q &&' "${CLIENT_DIR}"
    printf ' %q' "$@"
    printf '\n'
  else
    (cd "${CLIENT_DIR}" && "$@")
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slug)
      CLIENT_SLUG="${2:-}"
      shift 2
      ;;
    --output)
      OUTPUT_FILE="${2:-}"
      shift 2
      ;;
    --clients-root)
      CLIENTS_ROOT="${2:-}"
      shift 2
      ;;
    --data-root)
      DATA_ROOT="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --allow-aim)
      ALLOW_AIM=true
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      fail "opzione non riconosciuta: $1"
      ;;
  esac
done

[[ -n "${CLIENT_SLUG}" ]] || fail "--slug e' obbligatorio"
is_valid_slug "${CLIENT_SLUG}" || fail "slug non valido"
if is_protected_slug "${CLIENT_SLUG}" && [[ "${ALLOW_AIM}" != true ]]; then
  fail "lo slug ${CLIENT_SLUG} e' protetto. Usa --allow-aim solo se vuoi operare esplicitamente su AIM."
fi

CLIENT_DIR="${CLIENTS_ROOT}/${CLIENT_SLUG}"
ENV_FILE="${CLIENT_DIR}/.env.docker"
COMPOSE_FILE="${CLIENT_DIR}/docker-compose.prod.yml"
BACKUP_DIR="${DATA_ROOT}/${CLIENT_SLUG}/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${OUTPUT_FILE:-${BACKUP_DIR}/backup_${CLIENT_SLUG}_${TIMESTAMP}.dump}"
PARTIAL_FILE="${BACKUP_FILE}.partial"

[[ -d "${CLIENT_DIR}" ]] || fail "directory cliente non trovata: ${CLIENT_DIR}"
[[ -f "${COMPOSE_FILE}" ]] || fail "compose cliente non trovato: ${COMPOSE_FILE}"
[[ -f "${ENV_FILE}" ]] || fail ".env.docker cliente non trovato: ${ENV_FILE}"

if [[ "${DRY_RUN}" == true ]]; then
  log "[dry-run] creerei directory backup ${BACKUP_DIR}"
  run_client docker compose --env-file .env.docker -f docker-compose.prod.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'
  log "[dry-run] scriverei dump in ${BACKUP_FILE}"
  exit 0
fi

mkdir -p "${BACKUP_DIR}"
rm -f "${PARTIAL_FILE}"

(cd "${CLIENT_DIR}" && docker compose --env-file .env.docker -f docker-compose.prod.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc') >"${PARTIAL_FILE}"
mv "${PARTIAL_FILE}" "${BACKUP_FILE}"

BYTES="$(wc -c <"${BACKUP_FILE}" | tr -d ' ')"
log "Backup completato: ${BACKUP_FILE}"
log "Dimensione: ${BYTES} byte"
