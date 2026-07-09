#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

CLIENTS_ROOT="${CLIENTS_ROOT:-/opt/magazzino-clienti}"
DATA_ROOT="${DATA_ROOT:-/data/magazzino-clienti}"
TEMPLATE_DIR="${TEMPLATE_DIR:-${REPO_ROOT}/deploy/client-template}"
CLIENT_SLUG=""
CLIENT_DOMAIN=""
WEB_HOST_PORT=""
FORCE=false
DRY_RUN=false
ALLOW_AIM=false

usage() {
  cat <<'EOF'
Uso:
  scripts/client-env/create-client-env.sh --slug cliente-x --domain cliente-x.magazzinosolidale.it --port 8083

Opzioni:
  --slug SLUG             Slug cliente: lettere minuscole, numeri e trattini.
  --domain DOMINIO        Dominio pubblico del cliente.
  --port PORTA            Porta locale univoca esposta su 127.0.0.1.
  --clients-root DIR      Root stack clienti. Default: /opt/magazzino-clienti
  --data-root DIR         Root dati persistenti. Default: /data/magazzino-clienti
  --template-dir DIR      Directory template. Default: deploy/client-template
  --force                 Permette di sovrascrivere i file gia' presenti.
  --dry-run               Mostra cosa verrebbe creato senza scrivere file.
  --allow-aim             Permette esplicitamente lo slug angeli-in-moto/aim.
  --help                  Mostra questo aiuto.

Lo script non genera password deboli: lascia placeholder e stampa i prossimi passi.
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

validate_port() {
  [[ "$1" =~ ^[0-9]+$ ]] || return 1
  (( "$1" >= 1 && "$1" <= 65535 ))
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

require_writable_target() {
  local path="$1"
  if [[ -e "${path}" && "${FORCE}" != true ]]; then
    fail "${path} esiste gia'. Usa --force per sovrascriverlo."
  fi
}

write_compose() {
  local target="${CLIENTS_ROOT}/${CLIENT_SLUG}/docker-compose.prod.yml"
  require_writable_target "${target}"
  if [[ "${DRY_RUN}" == true ]]; then
    log "[dry-run] copierei ${TEMPLATE_DIR}/docker-compose.client.yml in ${target}"
    return
  fi
  cp "${TEMPLATE_DIR}/docker-compose.client.yml" "${target}"
}

write_env() {
  local target="${CLIENTS_ROOT}/${CLIENT_SLUG}/.env.docker"
  local db_slug="${CLIENT_SLUG//-/_}"
  local postgres_db="magazzino_${db_slug}"
  local postgres_user="magazzino_${db_slug}"

  require_writable_target "${target}"
  if [[ "${DRY_RUN}" == true ]]; then
    log "[dry-run] creerei ${target} con placeholder segreti"
    return
  fi

  cat >"${target}" <<EOF
CLIENT_SLUG=${CLIENT_SLUG}
COMPOSE_PROJECT_NAME=magazzino-${CLIENT_SLUG}
CLIENT_DOMAIN=${CLIENT_DOMAIN}
WEB_HOST_PORT=${WEB_HOST_PORT}

DATA_ROOT=${DATA_ROOT}
SOURCE_REPO_DIR=/opt/magazzino-sorgente/Magazzino-Solidale

POSTGRES_DB=${postgres_db}
POSTGRES_USER=${postgres_user}
POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD

DATABASE_URL=postgresql://${postgres_user}:CHANGE_ME_STRONG_PASSWORD@db:5432/${postgres_db}
SESSION_SECRET=CHANGE_ME_LONG_RANDOM_SECRET
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
APP_ORIGINS=https://${CLIENT_DOMAIN}
APP_BASE_URL=https://${CLIENT_DOMAIN}
PUBLIC_APP_URL=https://${CLIENT_DOMAIN}

NODE_ENV=production
EOF
  chmod 600 "${target}"
}

write_readme() {
  local target="${CLIENTS_ROOT}/${CLIENT_SLUG}/README.md"
  require_writable_target "${target}"
  if [[ "${DRY_RUN}" == true ]]; then
    log "[dry-run] creerei ${target}"
    return
  fi

  cat >"${target}" <<EOF
# Ambiente cliente ${CLIENT_SLUG}

Dominio: https://${CLIENT_DOMAIN}
Porta locale web: 127.0.0.1:${WEB_HOST_PORT}

## Percorsi

- Stack: ${CLIENTS_ROOT}/${CLIENT_SLUG}
- Dati: ${DATA_ROOT}/${CLIENT_SLUG}
- Backup: ${DATA_ROOT}/${CLIENT_SLUG}/backups

## Primo avvio

1. Compilare .env.docker con segreti forti.
2. Configurare Caddy:

   ${CLIENT_DOMAIN} {
       reverse_proxy 127.0.0.1:${WEB_HOST_PORT}
   }

3. Avviare il database:

   docker compose --env-file .env.docker -f docker-compose.prod.yml up -d db

4. Applicare lo schema:

   docker compose --env-file .env.docker -f docker-compose.prod.yml run --rm api pnpm --filter @workspace/db run push-force

5. Avviare lo stack:

   docker compose --env-file .env.docker -f docker-compose.prod.yml up -d --remove-orphans

## Note

Non committare .env.docker, backup, dump o log. Dopo il primo accesso Super Admin,
configurare ambiente, moduli funzionali e loghi documentali.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slug)
      CLIENT_SLUG="${2:-}"
      shift 2
      ;;
    --domain)
      CLIENT_DOMAIN="${2:-}"
      shift 2
      ;;
    --port)
      WEB_HOST_PORT="${2:-}"
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
    --template-dir)
      TEMPLATE_DIR="${2:-}"
      shift 2
      ;;
    --force)
      FORCE=true
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
[[ -n "${CLIENT_DOMAIN}" ]] || fail "--domain e' obbligatorio"
[[ -n "${WEB_HOST_PORT}" ]] || fail "--port e' obbligatorio"
is_valid_slug "${CLIENT_SLUG}" || fail "slug non valido: usare solo lettere minuscole, numeri e trattini"
validate_port "${WEB_HOST_PORT}" || fail "porta non valida: ${WEB_HOST_PORT}"
[[ "${CLIENT_DOMAIN}" != *"/"* && "${CLIENT_DOMAIN}" != *" "* ]] || fail "dominio non valido"
[[ -d "${TEMPLATE_DIR}" ]] || fail "template non trovato: ${TEMPLATE_DIR}"
[[ -f "${TEMPLATE_DIR}/docker-compose.client.yml" ]] || fail "manca docker-compose.client.yml nel template"

if is_protected_slug "${CLIENT_SLUG}" && [[ "${ALLOW_AIM}" != true ]]; then
  fail "lo slug ${CLIENT_SLUG} e' protetto. Usa --allow-aim solo se vuoi operare esplicitamente su AIM."
fi

CLIENT_DIR="${CLIENTS_ROOT}/${CLIENT_SLUG}"
DATA_DIR="${DATA_ROOT}/${CLIENT_SLUG}"

run mkdir -p "${CLIENT_DIR}"
run mkdir -p "${DATA_DIR}/postgres" "${DATA_DIR}/uploads" "${DATA_DIR}/exports" "${DATA_DIR}/backups"

write_compose
write_env
write_readme

log ""
log "Ambiente ${CLIENT_SLUG} predisposto."
log "Prossimi passi:"
log "1. Generare segreti forti, ad esempio: openssl rand -base64 48"
log "2. Compilare ${CLIENT_DIR}/.env.docker sostituendo CHANGE_ME_*"
log "3. Configurare Caddy per ${CLIENT_DOMAIN} -> 127.0.0.1:${WEB_HOST_PORT}"
log "4. Avviare lo stack dalla directory ${CLIENT_DIR}"
