#!/usr/bin/env bash
set -euo pipefail

CLIENTS_ROOT="${CLIENTS_ROOT:-/opt/magazzino-clienti}"
CLIENT_SLUG=""
BACKUP_FILE=""
DRY_RUN=false
ALLOW_AIM=false

usage() {
  cat <<'EOF'
Uso:
  scripts/client-env/restore-client.sh --slug cliente-x --backup /data/magazzino-clienti/cliente-x/backups/backup.dump

Opzioni:
  --slug SLUG             Slug cliente.
  --backup FILE           Dump pg_dump -Fc da ripristinare.
  --clients-root DIR      Root stack clienti. Default: /opt/magazzino-clienti
  --dry-run               Mostra cosa verrebbe eseguito senza ripristinare.
  --allow-aim             Permette esplicitamente lo slug angeli-in-moto/aim.
  --help                  Mostra questo aiuto.

Il restore sovrascrive il database cliente e richiede conferma forte:
  RESTORE cliente-x
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
    --backup)
      BACKUP_FILE="${2:-}"
      shift 2
      ;;
    --clients-root)
      CLIENTS_ROOT="${2:-}"
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
[[ -n "${BACKUP_FILE}" ]] || fail "--backup e' obbligatorio"
is_valid_slug "${CLIENT_SLUG}" || fail "slug non valido"
if is_protected_slug "${CLIENT_SLUG}" && [[ "${ALLOW_AIM}" != true ]]; then
  fail "lo slug ${CLIENT_SLUG} e' protetto. Usa --allow-aim solo se vuoi operare esplicitamente su AIM."
fi

CLIENT_DIR="${CLIENTS_ROOT}/${CLIENT_SLUG}"
ENV_FILE="${CLIENT_DIR}/.env.docker"
COMPOSE_FILE="${CLIENT_DIR}/docker-compose.prod.yml"

[[ -d "${CLIENT_DIR}" ]] || fail "directory cliente non trovata: ${CLIENT_DIR}"
[[ -f "${COMPOSE_FILE}" ]] || fail "compose cliente non trovato: ${COMPOSE_FILE}"
[[ -f "${ENV_FILE}" ]] || fail ".env.docker cliente non trovato: ${ENV_FILE}"
[[ -f "${BACKUP_FILE}" ]] || fail "backup non trovato: ${BACKUP_FILE}"

if [[ "${DRY_RUN}" != true ]]; then
  log "ATTENZIONE: il restore sovrascrive il database del cliente ${CLIENT_SLUG}."
  log "Backup sorgente: ${BACKUP_FILE}"
  log "Digitare esattamente: RESTORE ${CLIENT_SLUG}"
  read -r CONFIRMATION
  [[ "${CONFIRMATION}" == "RESTORE ${CLIENT_SLUG}" ]] || fail "conferma non valida, restore annullato"
else
  log "[dry-run] richiederei conferma forte: RESTORE ${CLIENT_SLUG}"
fi

run_client docker compose --env-file .env.docker -f docker-compose.prod.yml up -d db
run_client docker compose --env-file .env.docker -f docker-compose.prod.yml stop api web
run_client docker compose --env-file .env.docker -f docker-compose.prod.yml exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'

if [[ "${DRY_RUN}" == true ]]; then
  log "[dry-run] ripristinerei ${BACKUP_FILE} con pg_restore"
else
  (cd "${CLIENT_DIR}" && docker compose --env-file .env.docker -f docker-compose.prod.yml exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --role="$POSTGRES_USER"') <"${BACKUP_FILE}"
fi

run_client docker compose --env-file .env.docker -f docker-compose.prod.yml up -d --remove-orphans
run_client docker compose --env-file .env.docker -f docker-compose.prod.yml ps

log "Restore cliente ${CLIENT_SLUG} completato."
