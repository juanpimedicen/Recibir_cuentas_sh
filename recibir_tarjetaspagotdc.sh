#!/bin/sh

# Uso: /usr/src/scripts/ivr/recibir_tarjetaspagotdc.sh '<json>'
# Salida: cadena para READ()

if [ $# -ne 1 ]; then
  echo "Uso: $0 '<json>'"
  exit 1
fi

INPUT_JSON="$1"

# Rutas y audios
CONVERTED="/var/opt/motion2/server/files/sounds/converted"
DIGITS_PATH="/var/lib/asterisk/sounds/es/digits"

AUDIO_VISA="[2004]-1752614471084"   # “VISA”
AUDIO_MC="[2003]-1752614470248"     # “MasterCard”

# Audios "marque N" (solo nombres; se les antepone $CONVERTED/)
MARQUE_CODES="[260]-1752615204711 [261]-1752615205563 [262]-1752615206416 [263]-1752615207245 [264]-1752615208213 [265]-1752615209184 [266]-1752615210139 [267]-1752615210967 [268]-1752615211846"

# Tomamos hasta 9 tarjetas (0..8)
echo "$INPUT_JSON" \
| jq -r '.data.tarjetas[0:9][]?.tarjeta' \
| awk -v converted="$CONVERTED" -v digits="$DIGITS_PATH" -v visa="$AUDIO_VISA" -v mc="$AUDIO_MC" -v codes="$MARQUE_CODES" '
BEGIN {
  split(codes, marque_list, " ");   # lista de [260]...[268]
  out = "";
  idx = 0;
}
{
  t = $0;
  gsub(/ /, "", t);                 # quitar espacios de relleno
  if (length(t) < 4) next;

  idx++;
  prefix = substr(t, 1, 1);
  last4  = substr(t, length(t)-3, 4);

  # Audio de franquicia (visa/master)
  fran = (prefix == "4") ? visa : mc;

  # Construir bloque: franquicia + últimos 4 dígitos + "marque N"
  block = "'"'"'" converted "/" fran "'"'"'";

  # últimos 4 dígitos (SayDigits)
  for (i=1; i<=4; i++) {
    d = substr(last4, i, 1);
    block = block "&" "'"'"'" digits "/" d "'"'"'";
  }

  # Audio "marque N" correspondiente
  if (idx <= length(marque_list)) {
    block = block "&" "'"'"'" converted "/" marque_list[idx] "'"'"'";
  }

  # Acumular
  if (out == "") out = block; else out = out "&" block;
}
END {
  print out;
}'