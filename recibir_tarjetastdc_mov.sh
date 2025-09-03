#!/bin/sh

# Script: recibir_tarjetastdc_mov.sh
# Uso: ./recibir_tarjetastdc_mov.sh '<json>'
# Salida: cadena para READ()

# Verificación del parámetro
if [ $# -ne 1 ]; then
  echo "Uso: $0 '<json>'"
  exit 1
fi

INPUT_JSON="$1"

# Audios de franquicia (solo nombre, sin rutas)
AUDIO_VISA="[1081]-1752614450947"
AUDIO_MC="[1084]-1752614453753"

# Mapeo de audios "marque X" (solo nombre, sin rutas)
MARQUE_CODES="[260]-1752615204711 [261]-1752615205563 [262]-1752615206416 [263]-1752615207245 [264]-1752615208213 [265]-1752615209184 [266]-1752615210139 [267]-1752615210967 [268]-1752615211846"

# Procesar tarjetas (máximo 9)
echo "$INPUT_JSON" \
| jq -r '.data.tarjetas[0:9][] | .tarjeta' \
| awk -v visa="$AUDIO_VISA" -v mc="$AUDIO_MC" -v marque_codes="$MARQUE_CODES" '
BEGIN {
  count = 0
  firstBlock = 1
  split(marque_codes, MARQUES, " ")
}
{
  # quitar espacios internos
  gsub(/[[:space:]]/, "", $0)
  if (length($0) < 4) next

  count++
  prefix = substr($0, 1, 1)
  last4  = substr($0, length($0)-3, 4)

  # Selección de audio por franquicia (4 = Visa; otro => Master/otra)
  audio = (prefix == "4") ? visa : mc

  # Separador entre bloques
  if (firstBlock == 0) {
    printf "&"
  } else {
    firstBlock = 0
  }

  # Audio franquicia
  printf "'\''%s'\''", audio

  # Últimos 4 dígitos (sin rutas, solo numeritos)
  for (i = 1; i <= 4; i++) {
    digit = substr(last4, i, 1)
    printf "&'\''%s'\''", digit
  }

  # "marque N"
  if (count <= 9) {
    printf "&'\''%s'\''", MARQUES[count]
  }
}
END {
  printf "\n"
}'