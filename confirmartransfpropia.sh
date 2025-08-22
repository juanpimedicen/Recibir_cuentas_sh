#!/bin/bash
# Script: /usr/src/scripts/ivr/confirmartransfpropia.sh
# Uso: ./confirmartransfpropia.sh <monto> <cuentadeb> <cuentaacred>
# Salida: cadena para READ()

if [ $# -ne 3 ]; then
  echo "Uso: $0 <monto> <cuentadeb> <cuentaacred>"
  exit 1
fi

MONTO="$1"
CUENTA_DEB="$2"
CUENTA_ACRED="$3"

CONVERTED="/var/opt/motion2/server/files/sounds/converted"
DIGITS="/var/lib/asterisk/sounds/es/digits"

# Audios fijos
A_723="${CONVERTED}/[723]-1752615225781"       # "Usted introdujo"
A_1026="${CONVERTED}/[1026]-1754406097542"     # "Bolívares y"
A_2056="${CONVERTED}/[2056]-1754409695005"     # "céntimos"
A_805="${CONVERTED}/[805]-1752615228467"       # "Para debitar de la cuenta terminada en"
A_808="${CONVERTED}/[808]-1752615229414"       # "Para acreditar a la cuenta terminada en"
A_1039="${CONVERTED}/[1039]-1752614412501"     # "Si es correcto, marque 1. Si es incorrecto, marque 2."

# === Helpers ===

# say_number: compone números como en SayNumber() usando librería digits (no dígito a dígito)
# Soporta: 0-29, decenas exactas (30,40,...,90), centenas exactas (100..900),
# y combinaciones simples (125 = 100 & 25; 34 = 30 & 4).
say_number() {
  local n="$1"
  n=$((10#$n))  # normalizar (p.ej. "007" -> 7)

  # 0 directo
  if [[ $n -eq 0 ]]; then
    echo "'$DIGITS/0'"
    return
  fi

  # 1..29, decenas exactas <100, centenas exactas <=900
  if [[ $n -le 29 ]] || (( n < 100 && n % 10 == 0 )) || (( n % 100 == 0 && n <= 900 )); then
    echo "'$DIGITS/$n'"
    return
  fi

  local out=""
  if (( n >= 100 )); then
    local c=$(( n / 100 * 100 ))
    local r=$(( n % 100 ))
    out="'$DIGITS/$c'"
    if (( r > 0 )); then
      if (( r <= 29 )) || (( r < 100 && r % 10 == 0 )); then
        out="$out&'$DIGITS/$r'"
      else
        local d=$(( r / 10 * 10 ))
        local u=$(( r % 10 ))
        out="$out&'$DIGITS/$d'&'$DIGITS/$u'"
      fi
    fi
    echo "$out"
    return
  fi

  # 30..99 no múltiplos de 10 -> decena + unidad
  local d=$(( n / 10 * 10 ))
  local u=$(( n % 10 ))
  out="'$DIGITS/$d'"
  if (( u > 0 )); then
    out="$out&'$DIGITS/$u'"
  fi
  echo "$out"
}

# say_digits: enuncia dígito por dígito (SayDigits)
say_digits() {
  local str="$1"
  local out=""
  local first=1
  for (( i=0; i<${#str}; i++ )); do
    local d="${str:$i:1}"
    if [[ $d =~ [0-9] ]]; then
      if [[ $first -eq 1 ]]; then
        out="'$DIGITS/$d'"
        first=0
      else
        out="$out&'$DIGITS/$d'"
      fi
    fi
  done
  echo "$out"
}

# === Normalización de monto ===
FMT=$(echo "$MONTO" | awk '{printf "%.2f", $0}')
ENTERO="${FMT%.*}"
CENT="${FMT#*.}"

# Últimos 4 dígitos de cada cuenta
DEB4="${CUENTA_DEB: -4}"
ACRED4="${CUENTA_ACRED: -4}"

# === Construcción del READ ===
OUT="'$A_723'"
# Monto (parte entera)
OUT="$OUT&$(say_number "$ENTERO")"
# "Bolívares y"
OUT="$OUT&'$A_1026'"
# Céntimos (parte decimal)
OUT="$OUT&$(say_number "$CENT")&'$A_2056'"

# "Para debitar de la cuenta terminada en" + últimos 4 dígitos (SayDigits)
OUT="$OUT&'$A_805'&$(say_digits "$DEB4")"

# "Para acreditar a la cuenta terminada en" + últimos 4 dígitos (SayDigits)
OUT="$OUT&'$A_808'&$(say_digits "$ACRED4")"

# Confirmación final
OUT="$OUT&'$A_1039'"

echo "$OUT"
