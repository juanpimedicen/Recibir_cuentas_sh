#!/bin/bash

# Script: recibir_cuentasacred.sh
# Propósito: Generar cadena de audios para selección de cuenta destino en transferencia, excluyendo cuenta origen

# Verifica que se hayan recibido dos argumentos
if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Uso: $0 '<json>' '<cuenta_origen>'"
  exit 1
fi

# Rutas base
DIGITS_PATH="/var/lib/asterisk/sounds/es/digits"
AUDIO_ACREDITAR="/var/opt/motion2/server/files/sounds/converted/[808]-1752615229414"

# Map de audios de "marque N"
declare -A MARQUE_AUDIO
MARQUE_AUDIO=(
  [1]="/var/opt/motion2/server/files/sounds/converted/[260]-1752615204711"
  [2]="/var/opt/motion2/server/files/sounds/converted/[261]-1752615205563"
  [3]="/var/opt/motion2/server/files/sounds/converted/[262]-1752615206416"
  [4]="/var/opt/motion2/server/files/sounds/converted/[263]-1752615207245"
  [5]="/var/opt/motion2/server/files/sounds/converted/[264]-1752615208213"
  [6]="/var/opt/motion2/server/files/sounds/converted/[265]-1752615209184"
  [7]="/var/opt/motion2/server/files/sounds/converted/[266]-1752615210139"
  [8]="/var/opt/motion2/server/files/sounds/converted/[267]-1752615210967"
  [9]="/var/opt/motion2/server/files/sounds/converted/[268]-1752615211846"
)

# Entradas
JSON_INPUT="$1"
CUENTA_ORIGEN="$2"

# Filtrar cuentas en moneda BS que no sean la cuenta origen
CUENTAS=$(echo "$JSON_INPUT" | jq -r --arg origen "$CUENTA_ORIGEN" '.data[] | select(.moneda == "BS" and .cuenta12 != $origen) | .cuenta12' | tail -n 9)

# Construcción de salida
OUTPUT=""
INDEX=1

while IFS= read -r cuenta; do
  last4="${cuenta: -4}"
  line="'$AUDIO_ACREDITAR'"

  for ((i=0; i<${#last4}; i++)); do
    digit="${last4:$i:1}"
    line="$line&'$DIGITS_PATH/$digit'"
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
