#!/bin/bash

# Script: validar_cuentas.sh
# Propósito: Validar si el array "data" tiene más de un elemento con "moneda": "BS"

# Validar argumento
if [ -z "$1" ]; then
  echo "Uso: $0 '<json>'"
  exit 1
fi

JSON_INPUT="$1"

# Verificar si "data" contiene más de un objeto
total=$(echo "$JSON_INPUT" | jq '.data | length')

if [[ $total -le 1 ]]; then
  echo "false"
  exit 0
fi

# Contar cuántos elementos tienen moneda == "BS"
bs_count=$(echo "$JSON_INPUT" | jq '[.data[] | select(.moneda == "BS")] | length')

# Evaluar si hay más de un "BS"
if [[ $bs_count -gt 1 ]]; then
  echo "true"
else
  echo "false"
fi
