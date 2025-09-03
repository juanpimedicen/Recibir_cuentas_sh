#!/bin/bash

CONFIG_FILE="/usr/src/scripts/ivr/env.config.json"

# Validación de dependencia
if ! command -v jq &>/dev/null; then
  echo "Error: jq no está instalado. Instálalo con: sudo apt install jq"
  exit 1
fi

# Validación de archivo
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: Archivo de configuración $CONFIG_FILE no encontrado."
  exit 1
fi

# Asegurar que existan las ramas desa, calidad y prod
ensure_env_branches() {
  local tmp
  tmp=$(mktemp)
  jq '
    . as $root
    | (if has("desa") then . else .desa = {} end)
    | (if has("calidad") then . else .calidad = {} end)
    | (if has("prod") then . else .prod = {} end)
  ' "$CONFIG_FILE" > "$tmp" && mv "$tmp" "$CONFIG_FILE"
}
ensure_env_branches

# Función para confirmar acción
confirmar() {
  read -p "$1 [s/N]: " respuesta
  case "$respuesta" in
    [sS]) return 0 ;;
    *) return 1 ;;
  esac
}

# Mostrar resumen del servicio (tres ambientes)
mostrar_resumen() {
  local servicio="$1"
  echo -e "\n🔍 Resumen del servicio '$servicio':"
  jq --arg s "$servicio" '
    .desa[$s]    as $desa
    | .calidad[$s] as $calidad
    | .prod[$s]  as $prod
    | {desa: $desa, calidad: $calidad, prod: $prod}
  ' "$CONFIG_FILE"
}

# Crear objeto JSON desde un array asociativo
create_obj_json() {
  local -n vars=$1
  local obj="{"
  for k in "${!vars[@]}"; do
    obj+="\"$k\":\"${vars[$k]}\","
  done
  obj="${obj%,}}"
  echo "$obj"
}

# Copiar configuración de un servicio a otro (tres ambientes)
copiar_servicio() {
  local origen="$1"
  local destino="$2"

  # Verificar existencia del origen en al menos uno de los ambientes
  if ! jq -e --arg s "$origen" '(.desa|has($s)) or (.calidad|has($s)) or (.prod|has($s))' "$CONFIG_FILE" >/dev/null; then
    echo "❌ El servicio de origen '$origen' no existe en desa, calidad ni prod."
    exit 1
  fi

  # Si destino ya existe en alguno, confirmar sobrescritura
  if jq -e --arg s "$destino" '(.desa|has($s)) or (.calidad|has($s)) or (.prod|has($s))' "$CONFIG_FILE" >/dev/null; then
    if ! confirmar "⚠️ El servicio destino '$destino' ya existe en al menos un ambiente. ¿Sobrescribir?"; then
      echo "❌ Operación cancelada."
      exit 0
    fi
  fi

  local tmpfile
  tmpfile=$(mktemp)

  # Copiar por ambiente; si el origen no existe en un ambiente, copia desde desa si existe o deja {}
  jq --arg o "$origen" --arg d "$destino" '
    .desa[$d]    = (.desa[$o]    // .desa[$o] // {})
    | .calidad[$d] = (.calidad[$o] // .desa[$o] // {})
    | .prod[$d]   = (.prod[$o]   // .desa[$o] // {})
  ' "$CONFIG_FILE" > "$tmpfile"

  jq --arg s "$destino" '
    .desa[$s] as $desa
    | .calidad[$s] as $calidad
    | .prod[$s] as $prod
    | {desa: $desa, calidad: $calidad, prod: $prod}
  ' "$tmpfile"

  if confirmar "¿Deseas guardar estos cambios?"; then
    mv "$tmpfile" "$CONFIG_FILE"
    echo "✅ Servicio '$destino' copiado desde '$origen' (desa/calidad/prod)."
  else
    echo "❌ Cambios cancelados."
    rm -f "$tmpfile"
  fi
}

# CREAR / ACTUALIZAR SERVICIO COMPLETO (tres ambientes)
if [[ "$1" == "create" ]]; then
  shift
  servicio="$1"; shift

  if [[ -z "$servicio" ]]; then
    echo "Uso: $0 create nombre_servicio clave valor_desa valor_calidad valor_prod [...pares]"
    exit 1
  fi

  declare -A desa_vars
  declare -A calidad_vars
  declare -A prod_vars

  # Se esperan tuplas de 4: clave desa calidad prod
  while [[ $# -gt 0 ]]; do
    clave="$1"; desa_val="$2"; calidad_val="$3"; prod_val="$4"
    if [[ -z "$clave" || -z "$desa_val" || -z "$calidad_val" || -z "$prod_val" ]]; then
      echo "❌ Parámetros insuficientes para la clave '$clave'. Se esperan: clave valor_desa valor_calidad valor_prod"
      exit 1
    fi
    shift 4
    desa_vars["$clave"]="$desa_val"
    calidad_vars["$clave"]="$calidad_val"
    prod_vars["$clave"]="$prod_val"
  done

  desa_json=$(create_obj_json desa_vars)
  calidad_json=$(create_obj_json calidad_vars)
  prod_json=$(create_obj_json prod_vars)

  tmpfile=$(mktemp)
  # Mostrar resumen previo
  jq \
    --arg s "$servicio" \
    --argjson desa "$desa_json" \
    --argjson calidad "$calidad_json" \
    --argjson prod "$prod_json" \
    '.desa[$s] = $desa
     | .calidad[$s] = $calidad
     | .prod[$s] = $prod
     | {desa: .desa[$s], calidad: .calidad[$s], prod: .prod[$s]}' \
    "$CONFIG_FILE" > resumen.tmp

  cat resumen.tmp
  if confirmar "¿Deseas guardar estos cambios?"; then
    jq \
      --arg s "$servicio" \
      --argjson desa "$desa_json" \
      --argjson calidad "$calidad_json" \
      --argjson prod "$prod_json" \
      '.desa[$s] = $desa
       | .calidad[$s] = $calidad
       | .prod[$s] = $prod' \
      "$CONFIG_FILE" > "$tmpfile"
    mv "$tmpfile" "$CONFIG_FILE"
    echo "✅ Servicio '$servicio' creado/actualizado (desa/calidad/prod)."
  else
    echo "❌ Cambios cancelados."
    rm -f "$tmpfile"
  fi
  rm -f resumen.tmp

# ACTUALIZAR UNA CLAVE EXISTENTE
elif [[ "$1" == "update" ]]; then
  shift
  ambiente="$1"; servicio="$2"; clave="$3"; valor="$4"

  if [[ "$ambiente" != "desa" && "$ambiente" != "calidad" && "$ambiente" != "prod" ]]; then
    echo "Error: ambiente debe ser 'desa', 'calidad' o 'prod'"
    exit 1
  fi
  if [[ -z "$servicio" || -z "$clave" ]]; then
    echo "Uso: $0 update [desa|calidad|prod] nombre_servicio clave nuevo_valor"
    exit 1
  fi

  if ! jq -e --arg s "$servicio" --arg a "$ambiente" '.[$a] | has($s)' "$CONFIG_FILE" >/dev/null; then
    echo "Error: El servicio '$servicio' no existe en el ambiente '$ambiente'."
    exit 1
  fi

  tmpfile=$(mktemp)
  jq --arg a "$ambiente" --arg s "$servicio" --arg k "$clave" --arg v "$valor" \
    '.[$a][$s][$k] = $v' "$CONFIG_FILE" > "$tmpfile"

  jq --arg a "$ambiente" --arg s "$servicio" '.[$a][$s]' "$tmpfile"
  if confirmar "¿Deseas guardar estos cambios?"; then
    mv "$tmpfile" "$CONFIG_FILE"
    echo "✅ Clave '$clave' actualizada en '$servicio' ($ambiente)."
  else
    echo "❌ Cambios cancelados."
    rm -f "$tmpfile"
  fi

# INTERACTIVO
elif [[ "$1" == "interactive" ]]; then
  echo "🛠️ Modo interactivo iniciado."
  read -p "¿Qué deseas hacer? (create/update/copiar): " modo

  if [[ "$modo" == "create" ]]; then
    read -p "🔧 Nombre del nuevo servicio: " servicio
    declare -A desa_vars
    declare -A calidad_vars
    declare -A prod_vars

    while true; do
      read -p "📝 Nombre de la variable (deja vacío para terminar): " clave
      [[ -z "$clave" ]] && break
      read -p "Valor para 'desa'    : " val_desa
      read -p "Valor para 'calidad' : " val_calidad
      read -p "Valor para 'prod'    : " val_prod
      desa_vars["$clave"]="$val_desa"
      calidad_vars["$clave"]="$val_calidad"
      prod_vars["$clave"]="$val_prod"
    done

    desa_json=$(create_obj_json desa_vars)
    calidad_json=$(create_obj_json calidad_vars)
    prod_json=$(create_obj_json prod_vars)

    tmpfile=$(mktemp)
    jq \
      --arg s "$servicio" \
      --argjson desa "$desa_json" \
      --argjson calidad "$calidad_json" \
      --argjson prod "$prod_json" \
      '.desa[$s] = $desa
       | .calidad[$s] = $calidad
       | .prod[$s] = $prod
       | {desa: .desa[$s], calidad: .calidad[$s], prod: .prod[$s]}' \
      "$CONFIG_FILE" > resumen.tmp

    cat resumen.tmp
    if confirmar "¿Deseas guardar estos cambios?"; then
      jq \
        --arg s "$servicio" \
        --argjson desa "$desa_json" \
        --argjson calidad "$calidad_json" \
        --argjson prod "$prod_json" \
        '.desa[$s] = $desa
         | .calidad[$s] = $calidad
         | .prod[$s] = $prod' \
        "$CONFIG_FILE" > "$tmpfile"
      mv "$tmpfile" "$CONFIG_FILE"
      echo "✅ Servicio '$servicio' creado/actualizado (desa/calidad/prod)."
    else
      echo "❌ Cambios cancelados."
      rm -f "$tmpfile"
    fi
    rm -f resumen.tmp

  elif [[ "$modo" == "update" ]]; then
    read -p "🔄 Ambiente (desa/calidad/prod): " ambiente
    read -p "🔄 Nombre del servicio: " servicio
    read -p "🔄 Clave a modificar: " clave
    read -p "🔄 Nuevo valor: " valor

    if [[ "$ambiente" != "desa" && "$ambiente" != "calidad" && "$ambiente" != "prod" ]]; then
      echo "Error: ambiente debe ser 'desa', 'calidad' o 'prod'"
      exit 1
    fi
    if ! jq -e --arg s "$servicio" --arg a "$ambiente" '.[$a] | has($s)' "$CONFIG_FILE" >/dev/null; then
      echo "Error: El servicio '$servicio' no existe en el ambiente '$ambiente'."
      exit 1
    fi

    tmpfile=$(mktemp)
    jq --arg a "$ambiente" --arg s "$servicio" --arg k "$clave" --arg v "$valor" \
      '.[$a][$s][$k] = $v' "$CONFIG_FILE" > "$tmpfile"

    jq --arg a "$ambiente" --arg s "$servicio" '.[$a][$s]' "$tmpfile"
    if confirmar "¿Deseas guardar estos cambios?"; then
      mv "$tmpfile" "$CONFIG_FILE"
      echo "✅ Clave '$clave' actualizada en '$servicio' ($ambiente)."
    else
      echo "❌ Cambios cancelados."
      rm -f "$tmpfile"
    fi

  elif [[ "$modo" == "copiar" ]]; then
    read -p "📥 Nombre del servicio de origen: " origen
    read -p "📤 Nombre del nuevo servicio destino: " destino
    copiar_servicio "$origen" "$destino"

  else
    echo "Error: opción inválida. Usa 'create', 'update' o 'copiar'."
    exit 1
  fi

else
  echo "Uso:"
  echo "  $0 create nombre_servicio clave valor_desa valor_calidad valor_prod [clave valor_desa valor_calidad valor_prod ...]"
  echo "  $0 update [desa|calidad|prod] nombre_servicio clave nuevo_valor"
  echo "  $0 copiar servicio_origen servicio_destino"
  echo "  $0 interactive"
  exit 1
fi