#!/bin/bash

# Script: recibir_cuentasmov.sh
# Propósito: Generar cadena de audios para movimientos bancarios

# Validar argumento
if [ -z "$1" ]; then
  echo "Uso: $0 '<json>'"
  exit 1
fi

# JSON de entrada
JSON_INPUT="$1"

# Rutas base
BASE_AUDIO="/var/opt/motion2/server/files/sounds/converted"
DIGITS="/var/lib/asterisk/sounds/es/digits"

# Audios fijos
INTRO="${BASE_AUDIO}/[699]-1752615224067"
CREDITO="${BASE_AUDIO}/[1065]-1752614436461"
DEBITO="${BASE_AUDIO}/[1066]-1752614437314"
BOLIVARES="${BASE_AUDIO}/[1026]-1752614402030"
CON="${BASE_AUDIO}/[2017]-1754342507283"
CENTIMOS="${BASE_AUDIO}/[2018]-1754342506398"
CON_FECHA="${BASE_AUDIO}/[1067]-1752614438152"
PRIMERO="${BASE_AUDIO}/[1080]-1752614449692"
FINAL="'${BASE_AUDIO}/[1050]-1752614422776'&'${BASE_AUDIO}/[1029]-1752614405010'&'${BASE_AUDIO}/[1030]-1752614405921'"

# Meses
MESES=("" "${BASE_AUDIO}/[1068]-1752614439001" "${BASE_AUDIO}/[1069]-1752614439848" "${BASE_AUDIO}/[1070]-1752614440702" \
       "${BASE_AUDIO}/[1071]-1752614441551" "${BASE_AUDIO}/[1072]-1752614442382" "${BASE_AUDIO}/[1073]-1752614443285" \
       "${BASE_AUDIO}/[1074]-1752614444152" "${BASE_AUDIO}/[1075]-1752614445113" "${BASE_AUDIO}/[1076]-1752614446110" \
       "${BASE_AUDIO}/[1077]-1752614446975" "${BASE_AUDIO}/[1078]-1752614447930" "${BASE_AUDIO}/[1079]-1752614448871")

# Extraer primeros 5 movimientos
MOVIMIENTOS=$(echo "$JSON_INPUT" | jq -c '.data.movimientos[:5][]')

# Función para construir audios de un número compuesto
say_number() {
  local num=$1
  local output=""

  if [[ $num -eq 0 ]]; then
    echo "'$DIGITS/0'"
    return
  fi

  if [[ $num -le 29 || ($num -lt 100 && $((num % 10)) -eq 0) || ($num -lt 1000 && $((num % 100)) -eq 0) ]]; then
    echo "'$DIGITS/$num'"
    return
  fi

  if ((num >= 100)); then
    local centena=$((num / 100 * 100))
    local resto=$((num % 100))
    output="'$DIGITS/$centena'"
    if [[ $resto -ne 0 ]]; then
      output+="&'$DIGITS/$resto'"
    fi
  elif ((num >= 30)); then
    local decena=$((num / 10 * 10))
    local unidad=$((num % 10))
    output="'$DIGITS/$decena'"
    if [[ $unidad -ne 0 ]]; then
      output+="&'$DIGITS/$unidad'"
    fi
  fi

  echo "$output"
}

# Construcción
RESPUESTA=""

while read -r movimiento; do
  fecha=$(echo "$movimiento" | jq -r .fecha)
  monto=$(echo "$movimiento" | jq -r .monto)

  tipo_audio=$([[ $monto == -* ]] && echo "$DEBITO" || echo "$CREDITO")
  monto_abs=$(echo "$monto" | awk '{print ($1 < 0) ? -$1 : $1}')
  monto_entero=${monto_abs%.*}
  monto_decimal=${monto_abs#*.}
  
  dia=$(date -d "$fecha" +%d)
  mes=$(date -d "$fecha" +%-m)

  if [[ $dia == "01" ]]; then
    DIA_AUDIO="'$PRIMERO'"
  else
    dia_int=$((10#$dia))
    DIA_AUDIO=$(say_number $dia_int)
  fi

  AUDIOS_MONTO="$(say_number $monto_entero)&'$BOLIVARES'"

  if [[ $monto_decimal == "00" || -z $monto_decimal ]]; then
    AUDIOS_MONTO+="&'$CON'&'$DIGITS/0'&'$CENTIMOS'"
  else
    centavos=$(say_number $monto_decimal)
    AUDIOS_MONTO+="&'$CON'&$centavos&'$CENTIMOS'"
  fi

  AUDIOS_MOVIMIENTO="'$tipo_audio'&$AUDIOS_MONTO&'$CON_FECHA'&$DIA_AUDIO&'${MESES[$mes]}'"

  if [ -n "$RESPUESTA" ]; then
    RESPUESTA+="&$AUDIOS_MOVIMIENTO"
  else
    RESPUESTA="$AUDIOS_MOVIMIENTO"
  fi

done <<< "$MOVIMIENTOS"

# Agregar introducción al principio y final al final
RESPUESTA="'$INTRO'&$RESPUESTA&$FINAL"

echo "$RESPUESTA"
