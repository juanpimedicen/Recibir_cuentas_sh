#!/bin/bash

CONFIG_FILE="/usr/src/scripts/ivr/env.config.json"

# Validar que jq esté instalado
if ! command -v jq &> /dev/null; then
    echo "Error: jq no está instalado. Instálalo con: sudo apt install jq"
    exit 1
fi

# Validar argumento
if [[ "$1" != "desa" && "$1" != "prod" ]]; then
    echo "Uso: $0 [desa|prod]"
    exit 1
fi

AMBIENTE=$1

# Validar que el archivo de configuración existe
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "Error: Archivo de configuración $CONFIG_FILE no encontrado."
    exit 1
fi

# Validar permisos de lectura del archivo de configuración
if [[ ! -r "$CONFIG_FILE" ]]; then
    echo "Error: No tienes permisos para leer $CONFIG_FILE"
    exit 1
fi

# Extraer el bloque JSON del ambiente
RESULTADO=$(jq ".$AMBIENTE" "$CONFIG_FILE")
RETORNO=$?

# Imprimir resultado en pantalla
if [ $RETORNO -eq 0 ]; then
    echo "$RESULTADO"
else
    echo "Error al procesar JSON del ambiente '$AMBIENTE'"
    exit 1
fi
