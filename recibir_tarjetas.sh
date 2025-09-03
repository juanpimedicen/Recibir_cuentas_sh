#!/bin/sh

# Verificación del parámetro
if [ $# -ne 1 ]; then
  echo "Uso: $0 '<json>'"
  exit 1
fi

INPUT_JSON="$1"

# Nombres de audios (sin rutas)
AUDIO_VISA="[1062]-1752614434060"   # Visa
AUDIO_MC="[1083]-1752614452766"     # MasterCard

# Dígitos: solo el número (sin ruta ni extensión)
# Los "marque N": solo el nombre del audio (sin ruta)
MARQUE_CODES="[260]-1752615204711 [261]-1752615205563 [262]-1752615206416 [263]-1752615207245 [264]-1752615208213 [265]-1752615209184 [266]-1752615210139 [267]-1752615210967 [268]-1752615211846"

# Procesar tarjetas con jq + awk
echo "$INPUT_JSON" \
| jq -r '.data.tarjetas[0:9][] | .tarjeta' \
| awk -v visa="$AUDIO_VISA" -v mc="$AUDIO_MC" -v marque_codes="$MARQUE_CODES" '
BEGIN {
  count = 0
  split(marque_codes, MARQUE, " ")
  firstLine = 1
}
{
  # quitar espacios
  gsub(/ /, "", $0)
  if (length($0) < 4) next

  count++
  # prefijo para detectar franquicia
  prefix = substr($0, 1, 1)
  # últimos 4 dígitos
  last4 = substr($0, length($0)-3, 4)

  audio = (prefix == "4") ? visa : mc

  # armar línea: [VISA/MC] & d1 & d2 & d3 & d4 & [marqueX]
  line = "'"'"'" audio "'"'"'"
  for (i = 1; i <= 4; i++) {
    digit = substr(last4, i, 1)
    line = line "&" "'"'"'" digit "'"'"'"
  }

  if (count <= 9) {
    line = line "&" "'"'"'" MARQUE[count] "'"'"'"
  }

  # imprimir con & entre líneas, sin ampersand final extra
  if (firstLine == 1) {
    printf "%s", line
    firstLine = 0
  } else {
    printf "&%s", line
  }
}
END {
  printf "\n"
}
'