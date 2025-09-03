#!/bin/bash
# Script: /usr/src/scripts/ivr/confirmarpagotdc.sh
# Uso: ./confirmarpagotdc.sh <monto> <cuenta> <tarjeta>
# Salida: cadena para READ()

if [ $# -ne 3 ]; then
  echo "Uso: $0 <monto> <cuenta> <tarjeta>"
  exit 1
fi

MONTO="$1"
CUENTA="$2"
TARJETA="$3"

CONVERTED="/var/opt/motion2/server/files/sounds/converted"
DIGITS="/var/lib/asterisk/sounds/es/digits"

# Audios fijos
A_723="[723]-1752615225781"      # Usted introdujo
A_1026="[1026]-1754406097542"    # Bolívares y
A_2056="[2056]-1754409695005"    # céntimos
A_805="[805]-1752615228467"      # Para debitar de la cuenta terminada en
A_1027="[1027]-1752614403059"    # a la tarjeta de crédito terminada en
A_1039="[1039]-1752614412501"    # Si es correcto, marque 1...

# ===== Helpers: numeración grande =====

# Dice 0–999 con tus audios (0 devuelve vacío; el 0 total se maneja fuera)
say_hundreds_block() {
  local n="$1"; n=$((10#$n))
  if (( n == 0 )); then echo ""; return; fi

  if (( n <= 29 )) || ( ((n < 100)) && ((n % 10 == 0)) ) || ( ((n % 100 == 0)) && (n <= 900) ); then
    echo "'$n'"; return
  fi

  local out=""
  if (( n >= 100 )); then
    local c=$(( n / 100 ))
    local r=$(( n % 100 ))
    if (( c == 1 )); then out="'ciento'"; else out="'${c}00'"; fi
    if (( r > 0 )); then
      if (( r <= 29 )) || ( ((r < 100)) && ((r % 10 == 0)) ); then
        out="$out&'$r'"
      else
        local d=$(( r / 10 * 10 ))
        local u=$(( r % 10 ))
        out="$out&'$d'"
        if (( u > 0 )); then out="$out&'$u'"; fi
      fi
    fi
    echo "$out"; return
  fi

  local d=$(( n / 10 * 10 ))
  local u=$(( n % 10 ))
  out="'$d'"; if (( u > 0 )); then out="$out&'$u'"; fi
  echo "$out"
}

# Agrupa en miles/millones/billones (posiciones 0..5)
say_number_big() {
  local num="$1"; num=$((10#$num))
  if (( num == 0 )); then echo "'0'"; return; fi

  declare -A parts
  local pos=0 rest="$num"
  while [[ -n "$rest" && "$rest" -ne 0 ]]; do
    local group=$(( rest % 1000 ))
    parts[$pos]=$(printf "%03d" $group)
    rest=$(( rest / 1000 ))
    pos=$((pos+1))
  done

  local keys=($(printf "%s\n" "${!parts[@]}" | sort -n))
  local out=""
  for idx in "${keys[@]}"; do
    local g="${parts[$idx]}"; local gnum=$((10#$g))
    (( gnum == 0 )) && continue
    local frag="$(say_hundreds_block "$gnum")"
    case "$idx" in
      1) frag="$frag&'thousand'";;
      2) if (( gnum == 1 )); then frag="$frag&'million'"; else frag="$frag&'millions'"; fi;;
      3) frag="$frag&'thousand'&'millions'";;
      4) if (( gnum == 1 )); then frag="$frag&'billion'"; else frag="$frag&'billions'"; fi;;
      5) frag="$frag&'thousand'&'billions'";;
    esac
    if [[ -z "$out" ]]; then out="$frag"; else out="$out&$frag"; fi
  done
  echo "$out"
}

# SayDigits para últimos 4
say_digits() {
  local s="$1" out="" first=1
  for ((i=0;i<${#s};i++)); do
    local d="${s:$i:1}"
    [[ "$d" =~ [0-9] ]] || continue
    if (( first )); then out="'$d'"; first=0; else out="$out&'$d'"; fi
  done
  echo "$out"
}

# Normalizar monto a 2 decimales
FMT=$(echo "$MONTO" | awk '{printf "%.2f", $0}')
ENTERO="${FMT%.*}"
CENT="${FMT#*.}"

CUENTA4="${CUENTA: -4}"
TARJETA4="${TARJETA: -4}"

OUT="'$A_723'"
OUT="$OUT&$(say_number_big "$ENTERO")"
OUT="$OUT&'$A_1026'"
OUT="$OUT&$(say_number_big "$CENT")&'$A_2056'"
OUT="$OUT&'$A_805'&$(say_digits "$CUENTA4")"
OUT="$OUT&'$A_1027'&$(say_digits "$TARJETA4")"
OUT="$OUT&'$A_1039'"

echo "$OUT"
