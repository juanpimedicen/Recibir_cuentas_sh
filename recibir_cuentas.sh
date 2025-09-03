#!/bin/bash

# Verifica que se haya recibido un argumento
if [ -z "$1" ]; then
  echo "Uso: $0 '<json>'"
  exit 1
fi

# Rutas base
DIGITS_PATH="/var/lib/asterisk/sounds/es/digits"
INTRO_AUDIO="[1060]-1752614432318"

# Map de audios de "marque N"
declare -A MARQUE_AUDIO
MARQUE_AUDIO=(
  [1]="[260]-1752615204711"
  [2]="[261]-1752615205563"
  [3]="[262]-1752615206416"
  [4]="[263]-1752615207245"
  [5]="[264]-1752615208213"
  [6]="[265]-1752615209184"
  [7]="[266]-1752615210139"
  [8]="[267]-1752615210967"
  [9]="[268]-1752615211846"
)

# Parseo de JSON
JSON_INPUT="$1"
CUENTAS=$(echo "$JSON_INPUT" | jq -r '.data[].cuenta12' | tail -n 9)

# Construcción de salida
OUTPUT=""
INDEX=1

while IFS= read -r cuenta; do
  last4="${cuenta: -4}" # Últimos 4 dígitos
  line="'$INTRO_AUDIO'"
  
  for ((i=0; i<${#last4}; i++)); do
    digit="${last4:$i:1}"
    line="$line&'$digit'"
  done

  line="$line&'${MARQUE_AUDIO[$INDEX]}'"
  
  if [ -n "$OUTPUT" ]; then
    OUTPUT="$OUTPUT&$line"
  else
    OUTPUT="$line"
  fi

  ((INDEX++))
done <<< "$CUENTAS"

# Resultado final
echo "$OUTPUT"
