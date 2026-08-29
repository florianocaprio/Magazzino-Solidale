#!/bin/sh
set -eu

repository_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
runtime_script="$repository_root/docker-entrypoint-web-runtime-config.sh"
test_root="$(mktemp -d)"

cleanup() {
  rm -rf "$test_root"
}

trap cleanup EXIT HUP INT TERM

assert_config() {
  expected_url="$1"
  expected_attribution="$2"

  node - "$test_root/config.js" "$expected_url" "$expected_attribution" <<'NODE'
const fs = require("node:fs");
const vm = require("node:vm");

const [, , configPath, expectedUrl, expectedAttribution] = process.argv;
const source = fs.readFileSync(configPath, "utf8");
const context = { window: {} };
vm.runInNewContext(source, context, { filename: "config.js" });

if (context.window.__APP_CONFIG__?.mapsTileUrl !== expectedUrl) {
  throw new Error(`mapsTileUrl inattesa: ${context.window.__APP_CONFIG__?.mapsTileUrl}`);
}
if (context.window.__APP_CONFIG__?.mapsTileAttribution !== expectedAttribution) {
  throw new Error(`mapsTileAttribution inattesa: ${context.window.__APP_CONFIG__?.mapsTileAttribution}`);
}
NODE
}

unset MAPS_TILE_URL MAPS_TILE_ATTRIBUTION
WEB_ROOT="$test_root" sh "$runtime_script"
assert_config \
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png' \
  '© OpenStreetMap contributors'

MAPS_TILE_URL='https://tile.openstreetmap.org/{z}/{x}/{y}.png' \
  MAPS_TILE_ATTRIBUTION='© OpenStreetMap contributors' \
  WEB_ROOT="$test_root" \
  sh "$runtime_script"
assert_config \
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png' \
  '© OpenStreetMap contributors'

MAPS_TILE_URL='https://tiles.example.test/{z}/{x}/{y}.png' \
  MAPS_TILE_ATTRIBUTION='Example tiles' \
  WEB_ROOT="$test_root" \
  sh "$runtime_script"
assert_config \
  'https://tiles.example.test/{z}/{x}/{y}.png' \
  'Example tiles'

escaped_url='https://tiles.example.test/{z}/{x}/{y}.png?style=a\b"c'
escaped_attribution="$(printf 'Example "tiles"\\source\nsecond line\rthird line')"
MAPS_TILE_URL="$escaped_url" \
  MAPS_TILE_ATTRIBUTION="$escaped_attribution" \
  WEB_ROOT="$test_root" \
  sh "$runtime_script"
assert_config "$escaped_url" "$escaped_attribution"

printf '%s\n' "Runtime config WEB: PASS"
