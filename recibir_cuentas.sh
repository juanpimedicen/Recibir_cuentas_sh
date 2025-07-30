#!/bin/sh

# Verifica que se pasó un parámetro
if [ $# -ne 1 ]; then
  echo "Uso: $0 '<json>'"
  exit 1
fi

# JSON como string
INPUT_JSON="$1"

# Ruta base de audios
AUDIO_BASE="/var/opt/motion2/server/files/sounds/converted/[1060]-1752614432318"
DIGITS_PATH="/var/lib/asterisk/sounds/es/digits"

# Mapeo de audios "marque X"
declare -a MARQUE_PATHS
MARQUE_PATHS[1]="/var/opt/motion2/server/files/sounds/converted/[260]-1752615204711"
MARQUE_PATHS[2]="/var/opt/motion2/server/files/sounds/converted/[261]-1752615205563"
MARQUE_PATHS[3]="/var/opt/motion2/server/files/sounds/converted/[262]-1752615206416"
MARQUE_PATHS[4]="/var/opt/motion2/server/files/sounds/converted/[263]-1752615207245"
MARQUE_PATHS[5]="/var/opt/motion2/server/files/sounds/converted/[264]-1752615208213"
MARQUE_PATHS[6]="/var/opt/motion2/server/files/sounds/converted/[265]-1752615209184"
MARQUE_PATHS[7]="/var/opt/motion2/server/files/sounds/converted/[266]-1752615210139"
MARQUE_PATHS[8]="/var/opt/motion2/server/files/sounds/converted/[267]-1752615210967"
MARQUE_PATHS[9]="/var/opt/motion2/server/files/sounds/converted/[268]-1752615211846"

# Extraer cuentas y procesar
echo "$INPUT_JSON" | jq -r '.data.RESPONSE[0:9][] | .cuenta12' | awk -v audio_base="$AUDIO_BASE" -v digits_path="$DIGITS_PATH" '
BEGIN {
  FS = "\n"
}
{
  count++
  output = "\x27" audio_base "\x27"
  len = length($0)
  last4 = substr($0, len - 3, 4)
  for (i = 1; i <= 4; i++) {
    digit = substr(last4, i, 1)
    output = output "&\x27" digits_path "/" digit ".gsm\x27"
  }
  marque = count + 259
  output = output "&\x27/var/opt/motion2/server/files/sounds/converted/[" marque "]-175261520" sprintf("%04d", 4711 + (count - 1) * 843) "\x27"
  if (count == 1)
    final = output
  else
    final = final "&" output
}
END {
  print final
}'
