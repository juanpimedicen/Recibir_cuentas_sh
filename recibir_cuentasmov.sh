#!/bin/bash

# Script: recibir_cuentasmov.sh
# Propósito: Generar cadena de audios para movimientos bancarios (hasta 5)
# - Sin audio "CON"
# - Montos con lógica extendida (miles, millones, etc.), suprime "1" en escalas
# - Si no hay decimales -> "0" céntimos

# Validar argumento
if [ -z "$1" ]; then
  echo "Uso: $0 '<json>'"
  exit 1
fi

JSON_INPUT="$1"

# Audios fijos (solo nombre)
INTRO="[699]-1752615224067"
CREDITO="[1065]-1752614436461"
DEBITO="[1066]-1752614437314"
BOLIVARES="[1026]-1754406097542"
CENTIMOS="[2056]-1754409695005"
CON_FECHA="[1067]-1752614438152"
PRIMERO="[1080]-1752614449692"
FINAL="'[1050]-1752614422776'&'[1029]-1752614405010'&'[1030]-1752614405921'"

# Meses (solo nombre; índice 1..12)
MESES=("" "[1068]-1752614439001" "[1069]-1752614439848" "[1070]-1752614440702" \
       "[1071]-1752614441551" "[1072]-1752614442382" "[1073]-1752614443285" \
       "[1074]-1752614444152" "[1075]-1752614445113" "[1076]-1752614446110" \
       "[1077]-1752614446975" "[1078]-1752614447930" "[1079]-1752614448871")

# Extraer primeros 5 movimientos
MOVIMIENTOS=$(echo "$JSON_INPUT" | jq -c '.data.movimientos[:5][]')

# ---- Helpers ----

# Normaliza a 2 decimales y separa entero|centavos
split_amount() {
  local amt="$1"
  local fmt
  fmt=$(echo "$amt" | awk '{printf "%.2f", $0}')
  local entero="${fmt%.*}"
  local dec="${fmt#*.}"
  echo "$entero|$dec"
}

# 0..999 usando audios dedicados:
# - 0..99: un solo audio ('45')
# - 100: '100'
# - 101..199: 'ciento' & 'resto(<100)'
# - 200..900 exactos: '200','300',...
# - 201..999 no exactos: '200' & 'resto(<100)'
say_number_small() {
  local n="$1"
  n=$((10#$n))

  if (( n == 0 )); then echo "'0'"; return; fi
  if (( n < 100 )); then echo "'$n'"; return; fi
  if (( n == 100 )); then echo "'100'"; return; fi

  if (( n > 100 && n < 200 )); then
    local r=$((n - 100))
    echo "'ciento'&'$r'"
    return
  fi

  local hundreds=$(( n / 100 * 100 ))    # 200,300,...,900
  local rest=$(( n % 100 ))              # 0..99
  if (( rest == 0 )); then
    echo "'$hundreds'"
  else
    echo "'$hundreds'&'$rest'"
  fi
}

# Grandes: agrupa en tríos y agrega thousand/million(s)/billion(s);
# si el grupo == 1 y es una escala (pos>=1), NO se dice "1", solo el sufijo.
say_number_large() {
  local num="$1"
  num=$(echo "$num" | sed 's/^0\+//')
  [[ -z "$num" ]] && num="0"

  # 0..999
  if (( ${#num} <= 3 )); then
    echo "$(say_number_small "$num")"
    return
  fi

  # Partir en grupos de 3 desde la derecha
  local groups=()
  local s="$num"
  while [[ -n "$s" ]]; do
    local chunk="${s: -3}"
    groups=("$chunk" "${groups[@]}")
    s="${s%${chunk}}"
  done

  local total=${#groups[@]}
  local out=""

  for i in "${!groups[@]}"; do
    local g="${groups[$i]}"
    g=$((10#$g)) # numérico
    [[ "$g" -eq 0 ]] && continue

    local pos=$(( total - 1 - i ))  # 0: unidades, 1: miles, 2: millones, 3: mil millones, 4: billones, 5: mil billones...
    local piece=""
    local suffix=""

    case "$pos" in
      0) # unidades, sin sufijo
         piece="$(say_number_small "$g")"
         ;;
      1) # miles
         suffix="'thousand'"
         if (( g == 1 )); then
           piece="$suffix"
         else
           piece="$(say_number_small "$g")&$suffix"
         fi
         ;;
      2) # millones
         suffix=$([[ "$g" -eq 1 ]] && echo "'million'" || echo "'millions'")
         if (( g == 1 )); then
           piece="$suffix"
         else
           piece="$(say_number_small "$g")&$suffix"
         fi
         ;;
      3) # miles de millones
         # siempre decir ... & 'thousand' & 'millions' (sin "1")
         if (( g == 1 )); then
           piece="'thousand'&'millions'"
         else
           piece="$(say_number_small "$g")&'thousand'&'millions'"
         fi
         ;;
      4) # billones
         suffix=$([[ "$g" -eq 1 ]] && echo "'billion'" || echo "'billions'")
         if (( g == 1 )); then
           piece="$suffix"
         else
           piece="$(say_number_small "$g")&$suffix"
         fi
         ;;
      5) # miles de billones
         if (( g == 1 )); then
           piece="'thousand'&'billions'"
         else
           piece="$(say_number_small "$g")&'thousand'&'billions'"
         fi
         ;;
      *) # no contemplamos escalas mayores con audios actuales
         piece="$(say_number_small "$g")"
         ;;
    esac

    if [[ -n "$out" ]]; then
      out="$out&$piece"
    else
      out="$piece"
    fi
  done

  [[ -z "$out" ]] && out="'0'"
  echo "$out"
}

# ---- Construcción ----
RESPUESTA=""

while read -r movimiento; do
  fecha=$(echo "$movimiento" | jq -r .fecha)
  monto=$(echo "$movimiento" | jq -r .monto)

  # tipo (según signo)
  tipo_audio=$([[ $monto == -* ]] && echo "$DEBITO" || echo "$CREDITO")

  # valor absoluto
  monto_abs=$(echo "$monto" | awk '{print ($1 < 0) ? -$1 : $1}')

  # separar entero/centavos (dos dígitos)
  IFS='|' read -r entero cent <<< "$(split_amount "$monto_abs")"

  # fecha
  dia=$(date -d "$fecha" +%d 2>/dev/null)
  mes=$(date -d "$fecha" +%-m 2>/dev/null)

  # audio del día
  if [[ "$dia" == "01" ]]; then
    DIA_AUDIO="'$PRIMERO'"
  else
    dia_int=$((10#$dia))
    DIA_AUDIO=$(say_number_small "$dia_int")
  fi

  # monto: entero + "Bolívares" + centavos + "céntimos"
  MONTO_AUDIO="$(say_number_large "$entero")&'$BOLIVARES'"

  if [[ -z "$cent" || "$cent" == "00" ]]; then
    MONTO_AUDIO="$MONTO_AUDIO&'0'&'$CENTIMOS'"
  else
    cent_num=$((10#$cent))
    MONTO_AUDIO="$MONTO_AUDIO&$(say_number_small "$cent_num")&'$CENTIMOS'"
  fi

  # movimiento completo
  AUDIOS_MOVIMIENTO="'$tipo_audio'&$MONTO_AUDIO&'$CON_FECHA'&$DIA_AUDIO&'${MESES[$mes]}'"

  if [ -n "$RESPUESTA" ]; then
    RESPUESTA="$RESPUESTA&$AUDIOS_MOVIMIENTO"
  else
    RESPUESTA="$AUDIOS_MOVIMIENTO"
  fi
done <<< "$MOVIMIENTOS"

# Intro + contenido + final
RESPUESTA="'$INTRO'&$RESPUESTA&$FINAL"

echo "$RESPUESTA"