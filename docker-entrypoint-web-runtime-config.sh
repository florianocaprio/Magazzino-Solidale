#!/bin/sh
set -eu

maps_tile_url="${MAPS_TILE_URL:-https://tile.openstreetmap.org/{z}/{x}/{y}.png}"
maps_tile_attribution="${MAPS_TILE_ATTRIBUTION:-© OpenStreetMap contributors}"
printf 'window.__APP_CONFIG__ = { mapsTileUrl: "%s", mapsTileAttribution: "%s" };\n' "$maps_tile_url" "$maps_tile_attribution" \
  > /usr/share/nginx/html/config.js
