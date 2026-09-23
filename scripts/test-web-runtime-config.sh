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
  config_root="${3:-$test_root}"

  node - "$config_root/config.js" "$expected_url" "$expected_attribution" <<'NODE'
const fs = require("node:fs");
const vm = require("node:vm");

const [, , configPath, expectedUrl, expectedAttribution] = process.argv;
const source = fs.readFileSync(configPath, "utf8");
const context = { window: {} };
vm.runInNewContext(source, context, { filename: "config.js" });

const config = context.window.__APP_CONFIG__;
const keys = Object.keys(config ?? {}).sort();
if (keys.join(",") !== "mapsTileAttribution,mapsTileUrl") {
  throw new Error("Chiavi config inattese: " + keys.join(","));
}

function assertValue(key, expected) {
  const actual = config[key];
  if (actual === expected) return;
  const points = (value) => Array.from(String(value), (character) =>
    character.codePointAt(0).toString(16).padStart(4, "0"),
  );
  throw new Error(
    key + " diversa: lunghezza attesa=" + expected.length +
      ", ottenuta=" + String(actual).length +
      "; code point attesi=" + points(expected).join(" ") +
      "; ottenuti=" + points(actual).join(" "),
  );
}

assertValue("mapsTileUrl", expectedUrl);
assertValue("mapsTileAttribution", expectedAttribution);
NODE
}

# RT-01: default indipendenti per variabili assenti e vuote.
unset MAPS_TILE_URL MAPS_TILE_ATTRIBUTION
WEB_ROOT="$test_root" sh "$runtime_script"
assert_config \
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png' \
  '© OpenStreetMap contributors'

MAPS_TILE_ATTRIBUTION='Custom attribution' WEB_ROOT="$test_root" sh "$runtime_script"
assert_config 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' 'Custom attribution'
MAPS_TILE_URL='https://custom.test/{z}/{x}/{y}' WEB_ROOT="$test_root" sh "$runtime_script"
assert_config 'https://custom.test/{z}/{x}/{y}' '© OpenStreetMap contributors'
MAPS_TILE_URL='' MAPS_TILE_ATTRIBUTION='' WEB_ROOT="$test_root" sh "$runtime_script"
assert_config 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' '© OpenStreetMap contributors'
MAPS_TILE_URL='' MAPS_TILE_ATTRIBUTION='Custom attribution' WEB_ROOT="$test_root" sh "$runtime_script"
assert_config 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' 'Custom attribution'
MAPS_TILE_URL='https://custom.test/{z}/{x}/{y}' MAPS_TILE_ATTRIBUTION='' WEB_ROOT="$test_root" sh "$runtime_script"
assert_config 'https://custom.test/{z}/{x}/{y}' '© OpenStreetMap contributors'

# RT-02: gli assert standard e personalizzati originali restano coperti.
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

# RT-03: backslash seguito da b letterale, non U+0008.
literal_backslash_b='https://tiles.example.test/a\b'
MAPS_TILE_URL="$literal_backslash_b" MAPS_TILE_ATTRIBUTION='Backslash' WEB_ROOT="$test_root" sh "$runtime_script"
assert_config "$literal_backslash_b" 'Backslash'

# RT-04: l'URL originale con backslash e virgolette resta invariato.
escaped_url='https://tiles.example.test/{z}/{x}/{y}.png?style=a\b"c'
escaped_attribution="$(printf 'Example "tiles"\\source\nsecond line\rthird line')"
MAPS_TILE_URL="$escaped_url" \
  MAPS_TILE_ATTRIBUTION="$escaped_attribution" \
  WEB_ROOT="$test_root" \
  sh "$runtime_script"
assert_config "$escaped_url" "$escaped_attribution"

# RT-05: sequenze di escape letterali, backslash multipli e finale.
literal_sequences='https://tiles.test/\n\r\t\f\u0041\\end\'
MAPS_TILE_URL="$literal_sequences" MAPS_TILE_ATTRIBUTION="$literal_sequences" WEB_ROOT="$test_root" sh "$runtime_script"
assert_config "$literal_sequences" "$literal_sequences"

# RT-06: controlli reali, CRLF e newline anche in testa/coda.
real_controls="$(printf '\nhead\nline\r\nnext\ttab\bback\fform\rreturn\n@')"
real_controls="${real_controls%@}"
MAPS_TILE_URL="$real_controls" MAPS_TILE_ATTRIBUTION="$real_controls" WEB_ROOT="$test_root" sh "$runtime_script"
assert_config "$real_controls" "$real_controls"

# RT-07: il testo simile a codice resta dato nel contesto VM isolato.
code_like='"; window.__APP_CONFIG__.sentinel = true; // % $ ` '"'"' <script>'
MAPS_TILE_URL="$code_like" MAPS_TILE_ATTRIBUTION="$code_like" WEB_ROOT="$test_root" sh "$runtime_script"
assert_config "$code_like" "$code_like"

# RT-08: UTF-8 e separatori Unicode U+2028/U+2029.
unicode_value="Città © العربية 中文 $(printf '\342\200\250\342\200\251')"
MAPS_TILE_URL="$unicode_value" MAPS_TILE_ATTRIBUTION="$unicode_value" WEB_ROOT="$test_root" sh "$runtime_script"
assert_config "$unicode_value" "$unicode_value"

# RT-09: WEB_ROOT può contenere spazi.
spaced_root="$test_root/web root with spaces"
mkdir "$spaced_root"
MAPS_TILE_URL='https://space.test/path' MAPS_TILE_ATTRIBUTION='Space root' WEB_ROOT="$spaced_root" sh "$runtime_script"
assert_config 'https://space.test/path' 'Space root' "$spaced_root"

# RT-10: la seconda generazione sostituisce interamente la prima.
MAPS_TILE_URL='https://first.test/a\b' MAPS_TILE_ATTRIBUTION='First' WEB_ROOT="$test_root" sh "$runtime_script"
MAPS_TILE_URL='https://second.test/next' MAPS_TILE_ATTRIBUTION='Second' WEB_ROOT="$test_root" sh "$runtime_script"
assert_config 'https://second.test/next' 'Second'

# RT-11: errore di scrittura/pubblicazione senza perdere il file valido.
if WEB_ROOT="$test_root/missing-parent" sh "$runtime_script" >/dev/null 2>&1; then
  printf '%s\n' 'Il generatore ha accettato una WEB_ROOT inesistente' >&2
  exit 1
fi
if [ -e "$test_root/missing-parent/config.js" ]; then
  printf '%s\n' 'Il generatore ha lasciato un config.js parziale' >&2
  exit 1
fi
mkdir "$test_root/failing-bin"
printf '#!/bin/sh\nexit 1\n' > "$test_root/failing-bin/mv"
chmod +x "$test_root/failing-bin/mv"
if PATH="$test_root/failing-bin:$PATH" MAPS_TILE_URL='https://not-published.test' \
  MAPS_TILE_ATTRIBUTION='Not published' WEB_ROOT="$test_root" sh "$runtime_script" >/dev/null 2>&1; then
  printf '%s\n' 'Il generatore ha ignorato il fallimento di mv' >&2
  exit 1
fi
assert_config 'https://second.test/next' 'Second'
set -- "$test_root"/.config.js.*
if [ -e "$1" ]; then
  printf '%s\n' 'Il generatore ha lasciato un file temporaneo parziale' >&2
  exit 1
fi

printf '%s\n' "Runtime config WEB: PASS"
