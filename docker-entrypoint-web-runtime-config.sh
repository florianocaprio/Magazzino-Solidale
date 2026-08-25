#!/bin/sh
set -eu

maps_key="${GOOGLE_MAPS_BROWSER_API_KEY:-}"
case "$maps_key" in
  *[!A-Za-z0-9_-]*)
    echo "GOOGLE_MAPS_BROWSER_API_KEY contiene caratteri non validi" >&2
    exit 1
    ;;
esac

printf 'window.__APP_CONFIG__ = { googleMapsApiKey: "%s" };\n' "$maps_key" \
  > /usr/share/nginx/html/config.js
