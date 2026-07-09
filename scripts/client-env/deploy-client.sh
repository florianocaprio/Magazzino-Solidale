#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CLIENTS_ROOT="${CLIENTS_ROOT:-/opt/magazzino-clienti}"
DATA_ROOT="${DATA_ROOT:-/data/magazzino-clienti}"
CLIENT_SLUG=""
CODE_DIR=""
SKIP_BACKUP=false
SKIP_GIT_PULL=false
DRY_RUN=false
ALLOW_AIM=false

usage() {
  cat <<'EOF'
Uso:
  scripts/client-env/deploy-client.sh --slug cliente-x

Opzioni:
  --slug SLUG             Slug cliente.
  --clients-root DIR      Root stack clienti. Default: /opt/magazzino-clienti
  --data-root DIR         Root dati persistenti. Default: /data/magazzino-clienti
  --code-dir DIR          Repository sorgente. Se omesso legge SOURCE_REPO_DIR da .env.docker.
  --skip-backup           Salta il backup pre-deploy.
  --skip-git-pull         Non aggiorna il repository sorgente.
  --dry-run               Mostra i comandi senza eseguirli.
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

read_env_value() {
  local key="$1"
  local file="$2"
  awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "${file}"
}

run() {
  if [[ "${DRY_RUN}" == true ]]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
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
    --clients-root)
      CLIENTS_ROOT="${2:-}"
      shift 2
      ;;
    --data-root)
      DATA_ROOT="${2:-}"
      shift 2
      ;;
    --code-dir)
      CODE_DIR="${2:-}"
      shift 2
      ;;
    --skip-backup)
      SKIP_BACKUP=true
      shift
      ;;
    --skip-git-pull)
      SKIP_GIT_PULL=true
      shift
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

[[ -d "${CLIENT_DIR}" ]] || fail "directory cliente non trovata: ${CLIENT_DIR}"
[[ -f "${COMPOSE_FILE}" ]] || fail "compose cliente non trovato: ${COMPOSE_FILE}"
[[ -f "${ENV_FILE}" ]] || fail ".env.docker cliente non trovato: ${ENV_FILE}"

if [[ -z "${CODE_DIR}" ]]; then
  CODE_DIR="$(read_env_value SOURCE_REPO_DIR "${ENV_FILE}")"
fi
CLIENT_DOMAIN="$(read_env_value CLIENT_DOMAIN "${ENV_FILE}")"

if [[ "${SKIP_BACKUP}" != true ]]; then
  backup_args=(--slug "${CLIENT_SLUG}" --clients-root "${CLIENTS_ROOT}" --data-root "${DATA_ROOT}")
  if [[ "${ALLOW_AIM}" == true ]]; then
    backup_args+=(--allow-aim)
  fi
  run "${SCRIPT_DIR}/backup-client.sh" "${backup_args[@]}"
else
  log "Backup pre-deploy saltato su richiesta esplicita."
fi

if [[ "${SKIP_GIT_PULL}" != true ]]; then
  if [[ -n "${CODE_DIR}" && -d "${CODE_DIR}/.git" ]]; then
    run git -C "${CODE_DIR}" pull --ff-only
  else
    log "Repository sorgente non rilevato: salto git pull. Impostare SOURCE_REPO_DIR o --code-dir."
  fi
fi

run_client docker compose --env-file .env.docker -f docker-compose.prod.yml build
run_client docker compose --env-file .env.docker -f docker-compose.prod.yml up -d db
run_client docker compose --env-file .env.docker -f docker-compose.prod.yml run --rm api pnpm --filter @workspace/db run push-force
run_client docker compose --env-file .env.docker -f docker-compose.prod.yml up -d --remove-orphans
run_client docker compose --env-file .env.docker -f docker-compose.prod.yml ps

log ""
log "Deploy cliente ${CLIENT_SLUG} completato."
log "Verifiche consigliate:"
log "- curl -I https://${CLIENT_DOMAIN:-CLIENT_DOMAIN}"
log "- login Super Admin"
log "- PDF di test"
