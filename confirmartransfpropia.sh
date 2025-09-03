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

CONVERTED=""
DIGITS="/var/lib/asterisk/sounds/es/digits"

# Audios fijos (con ruta completa; sin extensión)
A_723="[723]-1752615225781"      # "Usted introdujo"
A_1026="[1026]-1754406097542"    # "Bolívares y"
A_2056="[2056]-1754409695005"    # "céntimos"
A_805="[805]-1752615228467"      # "Para debitar de la cuenta terminada en"
A_808="[808]-1752615229414"      # "Para acreditar a la cuenta terminada en"
A_1039="[1039]-1752614412501"    # "Si es correcto, marque 1. Si es incorrecto, marque 2."

# =========================
# Helpers de locución numérica
# =========================

# 0..99 directo (usa archivos 0.gsm..99.gsm que ya existen)
say_0_99_direct() {
  local n="$1"
  n=$((10#$n))
  echo "'$n'"
}

# 0..999: usa cientos exactos (100..900) si corresponde; si 1xx no exacto -> 'ciento' + (resto 0..99 directo)
say_0_999() {
  local n="$1"
  n=$((10#$n))

  # 0..99 → directo
  if (( n < 100 )); then
    echo "$(say_0_99_direct "$n")"
    return
  fi

  # centenas exactas (100,200,...,900) → archivo exacto
  if (( n % 100 == 0 )) && (( n <= 900 )); then
    echo "'$n'"
    return
  fi

  # centenas no exactas
  local c=$(( n / 100 ))     # 1..9
  local r=$(( n % 100 ))     # 1..99
  local out=""

  if (( c == 1 )); then
    out="'ciento'"
  else
    out="'${c}00'"
  fi

  out="$out&$(say_0_99_direct "$r")"
  echo "$out"
}

# Enteros grandes en grupos de 3 + escalas:
# idx=0 unidades, 1 thousand, 2 million(s), 3 thousand&millions, 4 billion(s), 5 thousand&billions
say_integer_large() {
  local n="$1"
  n=$(echo "$n" | sed 's/^0\+\([0-9]\)/\1/')  # quitar ceros a izquierda (salvo "0")
  [[ -z "$n" ]] && n="0"
  if [[ "$n" == "0" ]]; then echo "'0'"; return; fi

  # trocear en grupos de 3 desde el final
  declare -a groups=()
  local s="$n"
  while [[ -n "$s" ]]; do
    if (( ${#s} > 3 )); then
      groups+=( "${s: -3}" )
      s="${s:0:${#s}-3}"
    else
      groups+=( "$s" )
      s=""
    fi
  done
  # groups[0] = últimos 3; groups[1] = miles; groups[2] = millones; groups[3] = mil millones; groups[4] = billones; groups[5] = mil billones

  local out=""
  local first=1
  for idx in "${!groups[@]}"; do
    local g="${groups[$idx]}"
    local g3
    g3=$(printf "%03d" "$g")
    [[ "$g3" == "000" ]] && continue

    local chunk=""
    case $idx in
      0)  # unidades
          chunk="$(say_0_999 "$g3")"
          ;;
      1)  # miles
          if [[ "$g3" == "001" ]]; then
            chunk="'thousand'"
          else
            chunk="$(say_0_999 "$g3")&'thousand'"
          fi
          ;;
      2)  # millones
          if [[ "$g3" == "001" ]]; then
            chunk="$(say_0_999 1)&'million'"
          else
            chunk="$(say_0_999 "$g3")&'millions'"
          fi
          ;;
      3)  # mil millones
          if [[ "$g3" == "001" ]]; then
            chunk="'thousand'&'millions'"
          else
            chunk="$(say_0_999 "$g3")&'thousand'&'millions'"
          fi
          ;;
      4)  # billones
          if [[ "$g3" == "001" ]]; then
            chunk="$(say_0_999 1)&'billion'"
          else
            chunk="$(say_0_999 "$g3")&'billions'"
          fi
          ;;
      5)  # mil billones
          if [[ "$g3" == "001" ]]; then
            chunk="'thousand'&'billions'"
          else
            chunk="$(say_0_999 "$g3")&'thousand'&'billions'"
          fi
          ;;
      *)  # fuera de rango soportado
          chunk="$(say_0_999 "$g3")"
          ;;
    esac

    if (( first )); then
      out="$chunk"
      first=0
    else
      out="$chunk&$out"  # anteponer (vamos de menor a mayor)
    fi
  done

  echo "$out"
}

# SayDigits: enuncia dígito a dígito
say_digits() {
  local str="$1"
  local out=""
  local first=1
  for (( i=0; i<${#str}; i++ )); do
    local d="${str:$i:1}"
    if [[ $d =~ [0-9] ]]; then
      if (( first )); then
        out="'$d'"
        first=0
      else
        out="$out&'$d'"
      fi
    fi
  done
  echo "$out"
}

# =========================
# Normalización del monto
# =========================
FMT=$(echo "$MONTO" | awk '{printf "%.2f", $0}')
ENTERO="${FMT%.*}"
CENT="${FMT#*.}"

# Últimos 4 dígitos de cada cuenta
DEB4="${CUENTA_DEB: -4}"
ACRED4="${CUENTA_ACRED: -4}"

# =========================
# Construcción del READ
# =========================
OUT="'$A_723'"
# Parte entera con escalas (miles, millones, billones...)
OUT="$OUT&$(say_integer_large "$ENTERO")"
# "Bolívares y"
OUT="$OUT&'$A_1026'"
# Céntimos: 2 dígitos → decir como número (00 => 0)
CENT_NUM=$((10#$CENT))
OUT="$OUT&$(say_0_99_direct "$CENT_NUM")&'$A_2056'"

# Para debitar de la cuenta terminada en XXXX
OUT="$OUT&'$A_805'&$(say_digits "$DEB4")"
# Para acreditar a la cuenta terminada en YYYY
OUT="$OUT&'$A_808'&$(say_digits "$ACRED4")"

# Confirmación
OUT="$OUT&'$A_1039'"

echo "$OUT"