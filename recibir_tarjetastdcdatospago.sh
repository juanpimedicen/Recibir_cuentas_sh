#!/bin/bash
# Script: /usr/src/scripts/ivr/recibir_tarjetastdcdatospago.sh
# Uso: ./recibir_tarjetastdcdatospago.sh "<pagoMinimo>" "<saldoContado>"

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Uso: $0 \"<pagoMinimo>\" \"<saldoContado>\""
  exit 1
fi

# -------- normalización de montos (acepta coma o punto) --------
normalize_amount() {
  local s="$1"
  s="${s//[[:space:]]/}"
  [[ -z "$s" ]] && { echo "0"; return; }
  s="${s/,/.}"
  [[ "$s" =~ ^[0-9]+([.][0-9]+)?$ ]] || { echo "0"; return; }
  echo "$s"
}

PAGO_MINIMO="$(normalize_amount "$1")"
SALDO_CONTADO="$(normalize_amount "$2")"

# Rutas base - SOLO NOMBRES DE ARCHIVOS SIN RUTAS
A_1099="[1099]-1752614466659"      # Para abonar el pago mínimo, equivalente a
A_1026="[1026]-1754406097542"      # Bolívares y
A_2056="[2056]-1754409695005"      # céntimos
A_2000="[2000]-1752614467500"      # Para abonar el monto total...
A_2001="[2001]-1752614468355"      # Para abonar otro monto...
A_260="[260]-1752615204711"        # marque 1
A_261="[261]-1752615205563"        # marque 2

# ---------- helpers ----------

# Dice 0–999 correctamente
say_hundreds_block() {
  local n="$1"; n=$((10#$n))
  if (( n == 0 )); then echo ""; return; fi

  # Casos especiales para números como 100, 200, etc.
  if (( n % 100 == 0 )) && (( n <= 900 )); then
    echo "${n}"; return
  fi

  # Números simples (0-29) o múltiplos de 10 (30, 40, ..., 90)
  if (( n <= 29 )) || ( ((n < 100)) && ((n % 10 == 0)) ); then
    echo "${n}"; return
  fi

  # Números compuestos (ej: 125, 234, etc.)
  local out=""
  if (( n >= 100 )); then
    local c=$(( n / 100 ))
    local r=$(( n % 100 ))
    out="${c}00"
    if (( r > 0 )); then
      out="${out}&${r}"
    fi
    echo "$out"; return
  fi

  # Números entre 31-99 (excepto múltiplos de 10)
  local d=$(( n / 10 * 10 ))
  local u=$(( n % 10 ))
  out="${d}"
  if (( u > 0 )); then out="${out}&${u}"; fi
  echo "$out"
}

# Función mejorada para decir números grandes
say_number_big() {
  local num="$1"; num=$((10#$num))
  if (( num == 0 )); then echo "0"; return; fi

  local out=""
  local millones=$(( num / 1000000 ))
  local resto=$(( num % 1000000 ))
  local miles=$(( resto / 1000 ))
  local unidades=$(( resto % 1000 ))

  # Millones
  if (( millones > 0 )); then
    out="$(say_hundreds_block "$millones")"
    if (( millones == 1 )); then
      out="${out}&million"
    else
      out="${out}&millions"
    fi
  fi

  # Miles
  if (( miles > 0 )); then
    if [[ -n "$out" ]]; then out="${out}&"; fi
    out="${out}$(say_hundreds_block "$miles")"
    out="${out}&thousand"
  fi

  # Unidades
  if (( unidades > 0 )); then
    if [[ -n "$out" ]]; then out="${out}&"; fi
    out="${out}$(say_hundreds_block "$unidades")"
  fi

  echo "$out"
}

# split_amount: entero|dec (2 dígitos)
split_amount() {
  local amt="$1"
  local fmt; fmt=$(echo "$amt" | awk '{printf "%.2f", $0}')
  local entero="${fmt%.*}"
  local dec="${fmt#*.}"
  echo "$entero|$dec"
}

# Partir en entero y centavos
IFS='|' read -r PM_E PM_C <<< "$(split_amount "$PAGO_MINIMO")"
IFS='|' read -r SC_E SC_C <<< "$(split_amount "$SALDO_CONTADO")"

# Construcción SIN comillas
OUT="$A_1099"
OUT="$OUT&$(say_number_big "$PM_E")"
OUT="$OUT&$A_1026"
OUT="$OUT&$(say_number_big "$PM_C")&$A_2056"
OUT="$OUT&$A_260"

OUT="$OUT&$A_2000"
OUT="$OUT&$(say_number_big "$SC_E")"
OUT="$OUT&$A_1026"
OUT="$OUT&$(say_number_big "$SC_C")&$A_2056"
OUT="$OUT&$A_261"

OUT="$OUT&$A_2001"

echo "$OUT"