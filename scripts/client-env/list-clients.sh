#!/usr/bin/env bash
set -euo pipefail

CLIENTS_ROOT="${CLIENTS_ROOT:-/opt/magazzino-clienti}"
DATA_ROOT="${DATA_ROOT:-/data/magazzino-clienti}"
DRY_RUN=false

usage() {
  cat <<'EOF'
Uso:
  scripts/client-env/list-clients.sh

Opzioni:
  --clients-root DIR      Root stack clienti. Default: /opt/magazzino-clienti
  --data-root DIR         Root dati persistenti. Default: /data/magazzino-clienti
  --dry-run               Mostra la directory che verrebbe letta.
  --help                  Mostra questo aiuto.
EOF
}

read_env_value() {
  local key="$1"
  local file="$2"
  awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "${file}"
}

latest_backup() {
  local backup_dir="$1"
  if [[ ! -d "${backup_dir}" ]]; then
    printf 'nessuno'
    return
  fi
  local latest
  latest="$(find "${backup_dir}" -type f -name '*.dump' -print 2>/dev/null | sort | tail -n 1 || true)"
  if [[ -n "${latest}" ]]; then
    printf '%s' "${latest}"
  else
    printf 'nessuno'
  fi
}

container_status() {
  local client_dir="$1"
  if ! command -v docker >/dev/null 2>&1; then
    printf 'docker non disponibile'
    return
  fi
  if [[ ! -f "${client_dir}/docker-compose.prod.yml" || ! -f "${client_dir}/.env.docker" ]]; then
    printf 'compose incompleto'
    return
  fi
  local status
  status="$(cd "${client_dir}" && docker compose --env-file .env.docker -f docker-compose.prod.yml ps --format '{{.Name}}={{.State}}' 2>/dev/null | tr '\n' ' ' || true)"
  if [[ -n "${status}" ]]; then
    printf '%s' "${status}"
  else
    printf 'nessun container'
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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
    --help)
      usage
      exit 0
      ;;
    *)
      printf 'Errore: opzione non riconosciuta: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done

if [[ "${DRY_RUN}" == true ]]; then
  printf '[dry-run] leggerei ambienti da %s e backup da %s\n' "${CLIENTS_ROOT}" "${DATA_ROOT}"
  exit 0
fi

if [[ ! -d "${CLIENTS_ROOT}" ]]; then
  printf 'Nessun root clienti trovato: %s\n' "${CLIENTS_ROOT}"
  exit 0
fi

printf '%-24s %-42s %-8s %-28s %s\n' "SLUG" "DOMINIO" "PORTA" "ULTIMO BACKUP" "STATO"

for client_dir in "${CLIENTS_ROOT}"/*; do
  [[ -d "${client_dir}" ]] || continue
  slug="$(basename "${client_dir}")"
  env_file="${client_dir}/.env.docker"
  domain="-"
  port="-"
  if [[ -f "${env_file}" ]]; then
    domain="$(read_env_value CLIENT_DOMAIN "${env_file}")"
    port="$(read_env_value WEB_HOST_PORT "${env_file}")"
    [[ -n "${domain}" ]] || domain="-"
    [[ -n "${port}" ]] || port="-"
  fi
  backup="$(latest_backup "${DATA_ROOT}/${slug}/backups")"
  status="$(container_status "${client_dir}")"
  printf '%-24s %-42s %-8s %-28s %s\n' "${slug}" "${domain}" "${port}" "${backup}" "${status}"
done
