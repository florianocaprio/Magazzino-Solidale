#!/bin/sh
set -eu

maps_tile_url="${MAPS_TILE_URL:-}"
maps_tile_attribution="${MAPS_TILE_ATTRIBUTION:-}"

if [ -z "$maps_tile_url" ]; then
  maps_tile_url='https://tile.openstreetmap.org/{z}/{x}/{y}.png'
fi

if [ -z "$maps_tile_attribution" ]; then
  maps_tile_attribution='© OpenStreetMap contributors'
fi

js_escape() {
  awk '
    BEGIN { ORS = "" }
    {
      if (NR > 1) printf "\\n"
      gsub(/\\/, "\\\\")
      gsub(/\"/, "\\\"")
      gsub(/\r/, "\\r")
      printf "%s", $0
    }
  '
}

escaped_maps_tile_url="$(printf '%s' "$maps_tile_url" | js_escape)"
escaped_maps_tile_attribution="$(printf '%s' "$maps_tile_attribution" | js_escape)"

web_root="${WEB_ROOT:-/usr/share/nginx/html}"
config_file="$web_root/config.js"
temporary_file="$web_root/.config.js.$$"

cleanup() {
  rm -f "$temporary_file"
}

trap cleanup EXIT HUP INT TERM
umask 022

printf 'window.__APP_CONFIG__ = {\n  mapsTileUrl: "%s",\n  mapsTileAttribution: "%s"\n};\n' \
  "$escaped_maps_tile_url" \
  "$escaped_maps_tile_attribution" \
  > "$temporary_file"

mv "$temporary_file" "$config_file"
trap - EXIT HUP INT TERM
