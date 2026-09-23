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

web_root="${WEB_ROOT:-/usr/share/nginx/html}"
config_file="$web_root/config.js"
temporary_file="$web_root/.config.js.$$"
umask 077
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/web-runtime-config.XXXXXX")"
input_file="$work_dir/input"
bytes_file="$work_dir/bytes"

cleanup() {
  rm -f "$temporary_file"
  rm -f "$input_file" "$bytes_file"
  rmdir "$work_dir"
}

trap cleanup EXIT HUP INT TERM

js_escape() {
  printf '%s' "$1" > "$input_file" || return 1
  LC_ALL=C od -An -tu1 -v "$input_file" > "$bytes_file" || return 1
  LC_ALL=C awk '
    {
      for (i = 1; i <= NF; i++) {
        byte = $i + 0
        if (byte == 34) printf "\\\""
        else if (byte == 92) printf "\\\\"
        else if (byte == 8) printf "\\b"
        else if (byte == 9) printf "\\t"
        else if (byte == 10) printf "\\n"
        else if (byte == 12) printf "\\f"
        else if (byte == 13) printf "\\r"
        else if (byte < 32 || byte == 127) printf "\\u%04x", byte
        else printf "%c", byte
      }
    }
  ' "$bytes_file"
}

escaped_maps_tile_url="$(js_escape "$maps_tile_url")"
escaped_maps_tile_attribution="$(js_escape "$maps_tile_attribution")"

umask 022

printf 'window.__APP_CONFIG__ = {\n  mapsTileUrl: "%s",\n  mapsTileAttribution: "%s"\n};\n' \
  "$escaped_maps_tile_url" \
  "$escaped_maps_tile_attribution" \
  > "$temporary_file"

mv "$temporary_file" "$config_file"
cleanup
trap - EXIT HUP INT TERM
