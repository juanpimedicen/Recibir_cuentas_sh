const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3435;

const { execFile } = require('child_process');
const axios = require('axios');

app.use(express.json());

app.post('/ivr/env', (req, res) => {
    const ambiente = req.body?.ambiente;
    const CONFIG_FILE = '/usr/src/scripts/ivr/env.config.json';

    // Agregar 'calidad' a la lista de ambientes válidos
    if (!ambiente || !['desa', 'prod', 'calidad'].includes(ambiente)) {
        return res.status(400).json({ error: 'Debe enviar el campo "ambiente" como "desa", "prod" o "calidad".' });
    }

    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            return res.status(500).json({ error: 'Archivo de configuración no encontrado.' });
        }

        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const config = JSON.parse(raw);

        if (!config[ambiente]) {
            return res.status(404).json({ error: `No se encontró configuración para '${ambiente}'` });
        }

        return res.status(200).json(config[ambiente]);
    } catch (err) {
        return res.status(500).json({ error: 'Error al procesar la configuración', detalle: err.message });
    }
});

app.post('/ivr/limpiarcuentasbs', (req, res) => {
  try {
    const rawData = req.body.data;

    if (!rawData) {
      return res.status(400).json({ success: false, message: "Falta el parámetro 'data'" });
    }

    let parsed;
    try {
      parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch (e) {
      return res.status(400).json({ success: false, message: "JSON inválido en 'data'" });
    }

    if (!Array.isArray(parsed.data)) {
      return res.status(400).json({ success: false, message: "'data.data' debe ser un array" });
    }

    const filtradas = parsed.data.filter(cuenta => cuenta.moneda === "BS");

    return res.json({
      success: true,
      message: "Cuentas filtradas correctamente",
      data: filtradas
    });
  } catch (error) {
    console.error('Error en /ivr/limpiarcuentasbs:', error);
    return res.status(500).json({ success: false, message: "Error interno del servidor" });
  }
});

// /ivr/recibir (endpoint unificado)
app.post('/ivr/recibir', async (req, res) => {
  const { accion } = req.body || {};
  if (!accion) {
    return res.status(400).json({ code: 400, message: 'Parámetro "accion" es requerido', read: '', contador: 0 });
  }

  // Helpers compartidos
  const callUpstream = async ({ url, headers, payload }) => {
    const resp = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${headers.bearer}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 15000
    });
    return {
      status: resp.status,
      data: resp.data,
      message: resp.data?.message || resp.data?.msg || `HTTP ${resp.status}`
    };
  };

  const runScript = (scriptPath, rawData) => new Promise((resolve) => {
    let jsonArg;
    try {
      jsonArg = JSON.stringify(rawData);
    } catch (e) {
      return resolve({ error: `No se pudo serializar JSON para el script: ${e.message}` });
    }
    execFile('/bin/bash', [scriptPath, jsonArg], { timeout: 20000 }, (error, stdout, stderr) => {
      if (error) return resolve({ error: `Script error: ${error.message}`, stderr });
      return resolve({ out: (stdout || '').toString().trim() });
    });
  });

  try {
    switch (accion) {

      // ============ ACCIÓN: cuentas (v1)  (con info)============
      case 'cuentas': {
        const { bearer, cedularif, url } = req.body || {};
        if (!bearer || !cedularif || !url) {
          return res.status(400).json({ code: 400, message: 'Faltan: bearer, cedularif, url', read: '', contador: 0 });
        }

        let upstreamStatus, upstreamData, upstreamMessage;
        try {
          const { status, data, message } = await callUpstream({
            url, headers: { bearer }, payload: { cedularif }
          });
          upstreamStatus = status; upstreamData = data; upstreamMessage = message;
        } catch (err) {
          const status = err.response?.status || 500;
          const message = err.response?.data?.message || err.response?.data?.error || err.message || 'Error en conexión al upstream';
          return res.status(200).json({ code: status, message, read: '', contador: 0 });
        }

        // Filtrar solo cuentas en BS
        let filteredDataBS = [];
        let contadorBS = 0;
        
        try {
          const arr = Array.isArray(upstreamData?.data) ? upstreamData.data : upstreamData?.data?.data || [];
          filteredDataBS = arr.filter(x => x?.moneda === 'BS');
          contadorBS = filteredDataBS.length;
        } catch { 
          filteredDataBS = [];
          contadorBS = 0; 
        }

        // Crear copia de upstreamData con datos filtrados para el script
        const dataForScript = {
          ...upstreamData,
          data: filteredDataBS
        };

        const { out, error } = await runScript('/usr/src/scripts/ivr/recibir_cuentas.sh', dataForScript);
        if (error) {
          return res.status(200).json({ code: upstreamStatus, message: `${upstreamMessage} (${error})`, read: '', contador: contadorBS });
        }

        // Mantener la estructura original en info pero con datos filtrados
        const filteredInfo = {
          ...upstreamData,
          data: filteredDataBS
        };

        return res.status(200).json({
          code: upstreamStatus,
          message: upstreamMessage,
          read: out,
          contador: contadorBS,
          info: filteredInfo   // ← Info con solo cuentas BS
        });
      }

      // ============ ACCIÓN: cuentas_v2 (con info) ============
      case 'cuentas_v2': {
        const { bearer, cedularif, url } = req.body || {};
        if (!bearer || !cedularif || !url) {
          return res.status(400).json({ code: 400, message: 'Faltan: bearer, cedularif, url', read: '', contador: 0 });
        }

        let upstreamStatus, upstreamData, upstreamMessage;
        try {
          const { status, data, message } = await callUpstream({
            url, headers: { bearer }, payload: { cedularif }
          });
          upstreamStatus = status; upstreamData = data; upstreamMessage = message;
        } catch (err) {
          const status = err.response?.status || 500;
          const message = err.response?.data?.message || err.response?.data?.error || err.message || 'Error en conexión al upstream';
          return res.status(200).json({ code: status, message, read: '', contador: 0 });
        }

        let contadorBS = 0;
        try {
          const arr = Array.isArray(upstreamData?.data) ? upstreamData.data : upstreamData?.data?.data || [];
          if (Array.isArray(arr)) contadorBS = arr.filter(x => x?.moneda === 'BS').length;
        } catch { contadorBS = 0; }

        const { out, error } = await runScript('/usr/src/scripts/ivr/recibir_cuentasv2.sh', upstreamData);
        if (error) {
          return res.status(200).json({ code: upstreamStatus, message: `${upstreamMessage} (${error})`, read: '', contador: contadorBS });
        }

        return res.status(200).json({
          code: upstreamStatus,
          message: upstreamMessage,
          read: out,
          contador: contadorBS,
          info: upstreamData   // ya lo tenía, se mantiene
        });
      }

      // ============ ACCIÓN: cuentasmov ============
      case 'cuentasmov': {
        const { cuenta12, moneda, limite, paginas, bearer, url } = req.body || {};
        if (!cuenta12 || !moneda || typeof limite === 'undefined' || typeof paginas === 'undefined' || !bearer || !url) {
          return res.status(400).json({
            code: 400,
            message: 'Faltan: cuenta12, moneda, limite, paginas, bearer, url',
            read: '',
            contador: 0
          });
        }

        let upstreamStatus, upstreamData, upstreamMessage;
        try {
          const { status, data, message } = await callUpstream({
            url,
            headers: { bearer },
            payload: { cuenta12, moneda, limite, paginas }
          });
          upstreamStatus = status;
          upstreamData = data;
          upstreamMessage = message;
        } catch (err) {
          const status = err.response?.status || 500;
          const message =
            err.response?.data?.message ||
            err.response?.data?.msg ||
            err.response?.data?.error ||
            err.message ||
            'Error en conexión al upstream';

          return res.status(200).json({
            code: String(status),
            message,
            read: '',
            contador: 0,
            info: err.response?.data || {}
          });
        }

        // Tomar code y message exactamente como vienen del upstream (con fallback al HTTP status)
        const upstreamCode = upstreamData?.code != null ? String(upstreamData.code) : String(upstreamStatus);
        const upstreamMsg =
          upstreamData?.message ||
          upstreamData?.msg ||
          upstreamMessage ||
          `HTTP ${upstreamStatus}`;

        // Contador real de movimientos (informativo)
        let contadorReal = 0;
        try {
          contadorReal = Array.isArray(upstreamData?.data?.movimientos)
            ? upstreamData.data.movimientos.length
            : 0;
        } catch (_) {
          contadorReal = 0;
        }

        // Ejecutar el script con la respuesta CRUDA del upstream
        const { out, error } = await runScript('/usr/src/scripts/ivr/recibir_cuentasmov.sh', upstreamData);
        if (error) {
          return res.status(200).json({
            code: upstreamCode,
            message: `${upstreamMsg} (${error})`,
            read: '',
            contador: contadorReal,
            info: upstreamData
          });
        }

        return res.status(200).json({
          code: upstreamCode,     // ← tal cual del upstream
          message: upstreamMsg,   // ← tal cual del upstream
          read: out,
          contador: contadorReal, // ← informativo
          info: upstreamData
        });
      }


      // ============ ACCIÓN: cuentasdeb ============
      case 'cuentasdeb': {
        const { bearer, cedularif, url } = req.body || {};
        if (!bearer || !cedularif || !url) {
          return res.status(400).json({ 
            code: 400, 
            message: 'Faltan: bearer, cedularif, url', 
            read: '', 
            contador: 0, 
            info: [] 
          });
        }

        let upstreamStatus, upstreamData, upstreamMessage;
        try {
          const resp = await axios.post(url, { cedularif }, {
            headers: {
              'Authorization': `Bearer ${bearer}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            timeout: 15000
          });
          upstreamStatus = resp.status;
          upstreamData = resp.data;
          upstreamMessage = resp.data?.message || resp.data?.msg || `HTTP ${resp.status}`;
        } catch (err) {
          const status = err.response?.status || 500;
          const message = err.response?.data?.message || err.response?.data?.error || err.message || 'Error en conexión al upstream';
          return res.status(200).json({ code: status, message, read: '', contador: 0, info: [] });
        }

        // Tomar array de cuentas del payload (soporta data o data.data)
        const arr = Array.isArray(upstreamData?.data) 
          ? upstreamData.data
          : (Array.isArray(upstreamData?.data?.data) ? upstreamData.data.data : []);

        // Filtrar SOLO cuentas en BS y excluir las de estatus "O" o "T"
        const bsValidas = (Array.isArray(arr) ? arr : []).filter(x => {
          const monedaOk = String(x?.moneda || '').toUpperCase() === 'BS';
          const estatus = String(x?.estatus || '').toUpperCase();
          const estatusOk = estatus !== 'O' && estatus !== 'T';
          return monedaOk && estatusOk;
        });

        const contadorBS = bsValidas.length;

        // Construir el objeto "info" conservando estructura original, pero con data filtrada
        let infoFiltrado;
        if (Array.isArray(upstreamData?.data)) {
          infoFiltrado = { ...upstreamData, data: bsValidas };
        } else if (Array.isArray(upstreamData?.data?.data)) {
          infoFiltrado = { 
            ...upstreamData, 
            data: { ...upstreamData.data, data: bsValidas } 
          };
        } else {
          infoFiltrado = { ...upstreamData, data: bsValidas };
        }

        // Ejecutar el script con SOLO cuentas válidas
        let jsonArg;
        try {
          jsonArg = JSON.stringify(infoFiltrado);
        } catch (e) {
          return res.status(200).json({
            code: upstreamStatus,
            message: `${upstreamMessage} (No se pudo serializar JSON para el script)`,
            read: '',
            contador: contadorBS,
            info: infoFiltrado
          });
        }

        const scriptPath = '/usr/src/scripts/ivr/recibir_cuentasdeb.sh';
        return execFile('/bin/bash', [scriptPath, jsonArg], { timeout: 20000 }, (error, stdout, stderr) => {
          if (error) {
            console.error(`[cuentasdeb] Script error:`, error.message);
            if (stderr) console.error(`[cuentasdeb] stderr:`, stderr);
            return res.status(200).json({
              code: upstreamStatus,
              message: `${upstreamMessage} (Script error: ${error.message})`,
              read: '',
              contador: contadorBS,
              info: infoFiltrado
            });
          }

          const readString = (stdout || '').toString().trim();
          return res.status(200).json({
            code: upstreamStatus,
            message: upstreamMessage,
            read: readString,
            contador: contadorBS,
            info: infoFiltrado
          });
        });
      }

      // ============ ACCIÓN: cuentasacred ============
      // Usando cuenta20 de la cuenta ORIGEN (de débito) para excluirla y listar destino (BS)
      case 'cuentasacred': {
        const { bearer, cedularif, url, cuenta20 } = req.body || {};
        if (!bearer || !cedularif || !url || !cuenta20) {
          return res.status(400).json({
            code: 400,
            message: 'Faltan: bearer, cedularif, url, cuenta20',
            read: '',
            contador: 0,
            info: []
          });
        }

        // 1) Llamado al upstream
        let upstreamStatus, upstreamData, upstreamMessage;
        try {
          const resp = await axios.post(
            url,
            { cedularif },
            {
              headers: {
                'Authorization': `Bearer ${bearer}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              timeout: 15000
            }
          );
          upstreamStatus = resp.status;
          upstreamData  = resp.data;
          upstreamMessage = resp.data?.message || resp.data?.msg || `HTTP ${resp.status}`;
        } catch (err) {
          const status  = err.response?.status || 500;
          const message = err.response?.data?.message || err.response?.data?.error || err.message || 'Error en conexión al upstream';
          return res.status(200).json({
            code: status,
            message,
            read: '',
            contador: 0,
            info: []
          });
        }

        // 2) Buscar la cuenta origen por cuenta20 y obtener su cuenta12
        const arr = Array.isArray(upstreamData?.data)
          ? upstreamData.data
          : (Array.isArray(upstreamData?.data?.data) ? upstreamData.data.data : []);

        let origen12 = null;
        try {
          const origenObj = arr.find(x => String(x?.cuenta20 || '') === String(cuenta20));
          origen12 = origenObj?.cuenta12 || null;
        } catch (_) { /* noop */ }

        if (!origen12) {
          return res.status(200).json({
            code: 404,
            message: `No se encontró la cuenta origen con cuenta20=${cuenta20}`,
            read: '',
            contador: 0,
            info: []
          });
        }

        // 3) Filtrar info (para responder en 'info' y 'contador'): solo BS y distintas de la origen
        const bsSinOrigen = arr.filter(x =>
          String(x?.moneda || '').toUpperCase() === 'BS' &&
          String(x?.cuenta12 || '') !== String(origen12)
        );
        const infoFiltrado = { ...upstreamData, data: bsSinOrigen };
        const contador = bsSinOrigen.length;

        // 4) Llamar al script con 2 argumentos:
        //    - ARG1: JSON CRUDO COMPLETO del upstream (el script hará su filtrado interno BS y != origen)
        //    - ARG2: cuenta12 de la cuenta origen
        let jsonArg;
        try {
          jsonArg = JSON.stringify(upstreamData);
        } catch (e) {
          return res.status(200).json({
            code: upstreamStatus,
            message: `${upstreamMessage} (No se pudo serializar JSON para el script)`,
            read: '',
            contador,
            info: infoFiltrado
          });
        }

        const scriptPath = '/usr/src/scripts/ivr/recibir_cuentasacred.sh';
        return execFile('/bin/bash', [scriptPath, jsonArg, String(origen12)], { timeout: 20000 }, (error, stdout, stderr) => {
          if (error) {
            console.error(`[cuentasacred] Script error:`, error.message);
            if (stderr) console.error(`[cuentasacred] stderr:`, stderr);
            return res.status(200).json({
              code: upstreamStatus,
              message: `${upstreamMessage} (Script error: ${error.message})`,
              read: '',
              contador,
              info: infoFiltrado
            });
          }

          const readString = (stdout || '').toString().trim();
          return res.status(200).json({
            code: upstreamStatus,
            message: upstreamMessage,
            read: readString,
            contador,
            info: infoFiltrado
          });
        });
      }

      default:
        return res.status(400).json({ code: 400, message: `Acción no soportada: ${accion}`, read: '', contador: 0 });
    }
  } catch (err) {
    return res.status(500).json({ code: 500, message: `Error inesperado: ${err.message}`, read: '', contador: 0 });
  }
});



app.post('/ivr/recibir-cuentas', async (req, res) => {
  const { bearer, cedularif, url } = req.body || {};

  // Validaciones básicas
  if (!bearer || !cedularif || !url) {
    return res.status(400).json({
      code: 400,
      message: "Parámetros requeridos: bearer, cedularif, url",
      read: "",
      contador: 0
    });
  }

  let upstreamStatus = 0;
  let upstreamData = null;
  let upstreamMessage = "OK";

  try {
    // Llamado al upstream
    const upstreamResp = await axios.post(
      url,
      { cedularif },
      {
        headers: {
          "Authorization": `Bearer ${bearer}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        timeout: 15000
      }
    );

    upstreamStatus = upstreamResp.status;
    upstreamData = upstreamResp.data;
    // Intenta mapear un mensaje legible
    upstreamMessage =
      upstreamResp.data?.message ||
      upstreamResp.data?.msg ||
      `HTTP ${upstreamResp.status}`;
  } catch (err) {
    upstreamStatus = err.response?.status || 500;
    upstreamData = err.response?.data || { error: err.message };
    upstreamMessage =
      (err.response?.data && (err.response.data.message || err.response.data.error)) ||
      err.message ||
      "Error en conexión al upstream";

    // En caso de fallo upstream, respondemos ya con diagnóstico
    return res.status(200).json({
      code: upstreamStatus,
      message: upstreamMessage,
      read: "",
      contador: 0
    });
  }

  // Contador de cuentas BS
  let contadorBS = 0;
  try {
    const arr = Array.isArray(upstreamData?.data) ? upstreamData.data : upstreamData?.data?.data || [];
    if (Array.isArray(arr)) {
      contadorBS = arr.filter(item => item?.moneda === "BS").length;
    }
  } catch (_) {
    contadorBS = 0;
  }

  // Ejecutar el script recibir_cuentas.sh con la respuesta completa como argumento
  const scriptPath = '/usr/src/scripts/ivr/recibir_cuentas.sh';

  // Convertimos a JSON compacto para pasar como 1 solo argumento
  let jsonArg;
  try {
    jsonArg = JSON.stringify(upstreamData);
  } catch (e) {
    return res.status(200).json({
      code: upstreamStatus,
      message: `${upstreamMessage} (No se pudo serializar JSON para el script)`,
      read: "",
      contador: contadorBS
    });
  }

  execFile('/bin/bash', [scriptPath, jsonArg], { timeout: 15000 }, (error, stdout, stderr) => {
    if (error) {
      console.error(`[recibir_cuentas_read] Script error:`, error.message);
      if (stderr) console.error(`[recibir_cuentas_read] stderr:`, stderr);
      return res.status(200).json({
        code: upstreamStatus,
        message: `${upstreamMessage} (Script error: ${error.message})`,
        read: "",
        contador: contadorBS
      });
    }

    const readString = (stdout || '').toString().trim();

    return res.status(200).json({
      code: upstreamStatus,
      message: upstreamMessage,
      read: readString,
      contador: contadorBS
    });
  });
});

// /ivr/recibir-cuentasv2 enpoint para recibir cuentas con script mejorado
// Salidas: code, message, read, contador, info (con respuesta cruda)
app.post('/ivr/recibir-cuentasv2', async (req, res) => {
  const { bearer, cedularif, url } = req.body || {};

  // Validaciones básicas
  if (!bearer || !cedularif || !url) {
    return res.status(400).json({
      code: 400,
      message: "Parámetros requeridos: bearer, cedularif, url",
      read: "",
      contador: 0
    });
  }

  let upstreamStatus = 0;
  let upstreamData = null;
  let upstreamMessage = "OK";

  try {
    // Llamado al upstream (API externa)
    const upstreamResp = await axios.post(
      url,
      { cedularif },
      {
        headers: {
          "Authorization": `Bearer ${bearer}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        timeout: 15000
      }
    );

    upstreamStatus = upstreamResp.status;
    upstreamData = upstreamResp.data; // ← RESPUESTA CRUDA
    upstreamMessage =
      upstreamResp.data?.message ||
      upstreamResp.data?.msg ||
      `HTTP ${upstreamResp.status}`;
  } catch (err) {
    upstreamStatus = err.response?.status || 500;
    upstreamData = err.response?.data || { error: err.message };
    upstreamMessage =
      (err.response?.data && (err.response.data.message || err.response.data.error)) ||
      err.message ||
      "Error en conexión al upstream";

    // ❌ En caso de fallo upstream: NO incluir 'info'
    return res.status(200).json({
      code: upstreamStatus,
      message: upstreamMessage,
      read: "",
      contador: 0
    });
  }

  // Contador de cuentas BS (solo informativo, sin filtrar upstreamData)
  let contadorBS = 0;
  try {
    const arr = Array.isArray(upstreamData?.data) ? upstreamData.data : upstreamData?.data?.data || [];
    if (Array.isArray(arr)) {
      contadorBS = arr.filter(item => item?.moneda === "BS").length;
    }
  } catch (_) {
    contadorBS = 0;
  }

  // Ejecutar el script recibir_cuentasv2.sh con la RESPUESTA CRUDA como argumento
  const scriptPath = '/usr/src/scripts/ivr/recibir_cuentasv2.sh';

  let jsonArg;
  try {
    jsonArg = JSON.stringify(upstreamData); // ← crudo
  } catch (e) {
    return res.status(200).json({
      code: upstreamStatus,
      message: `${upstreamMessage} (No se pudo serializar JSON para el script)`,
      read: "",
      contador: contadorBS
    });
  }

  execFile('/bin/bash', [scriptPath, jsonArg], { timeout: 15000 }, (error, stdout, stderr) => {
    if (error) {
      console.error(`[recibir_cuentasv2] Script error:`, error.message);
      if (stderr) console.error(`[recibir_cuentasv2] stderr:`, stderr);
      return res.status(200).json({
        code: upstreamStatus,
        message: `${upstreamMessage} (Script error: ${error.message})`,
        read: "",
        contador: contadorBS
      });
    }

    const readString = (stdout || '').toString().trim();

    // ✅ En éxito: incluir 'info' con la RESPUESTA CRUDA del upstream
    return res.status(200).json({
      code: upstreamStatus,
      message: upstreamMessage,
      read: readString,
      contador: contadorBS,
      info: upstreamData
    });
  });
});

// /ivr/recibir-cuentasmov
app.post('/ivr/recibir-cuentasmov', async (req, res) => {
  const { cuenta12, moneda, limite, paginas, bearer, url } = req.body || {};

  if (!cuenta12 || !moneda || typeof limite === 'undefined' || typeof paginas === 'undefined' || !bearer || !url) {
    return res.status(400).json({
      code: 400,
      message: "Parámetros requeridos: cuenta12, moneda, limite, paginas, bearer, url",
      read: "",
      contador: 0
    });
  }

  let upstreamData = null;
  let upstreamCode = "999";
  let upstreamMessage = "Error desconocido";

  try {
    const upstreamResp = await axios.post(
      url,
      { cuenta12, moneda, limite, paginas },
      {
        headers: {
          "Authorization": `Bearer ${bearer}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        timeout: 15000
      }
    );

    upstreamData = upstreamResp.data; // crudo
    upstreamCode = upstreamData?.code ?? String(upstreamResp.status);
    upstreamMessage = upstreamData?.message || upstreamData?.msg || `HTTP ${upstreamResp.status}`;
  } catch (err) {
    const dataErr = err.response?.data || { error: err.message };
    const codeErr = dataErr?.code ?? String(err.response?.status || 500);
    const msgErr =
      (dataErr && (dataErr.message || dataErr.error)) ||
      err.message ||
      "Error en conexión al upstream";

    return res.status(200).json({
      code: codeErr,
      message: msgErr,
      read: "",
      contador: 0
    });
  }

  // --- Filtro por moneda === 'BS' (case-insensitive) ---
  const isBS = String(moneda || '').trim().toUpperCase() === 'BS';
  const filteredData = (() => {
    // Clon superficial + asegurar estructura
    const base = typeof upstreamData === 'object' && upstreamData !== null ? { ...upstreamData } : { data: {} };
    base.data = { ...(upstreamData?.data || {}) };

    if (!isBS) {
      // Si no es BS, dejamos la estructura pero vaciamos movimientos
      base.data.movimientos = [];
      // opcional: podríamos ajustar registros a 0 si viniera
      base.data.registros = 0;
    }
    return base;
  })();

  // Contador real (sobre el filtrado)
  let contador = 0;
  try {
    const movs = filteredData?.data?.movimientos;
    contador = Array.isArray(movs) ? movs.length : 0;
  } catch { contador = 0; }

  // Enviar al script el JSON ya filtrado (para BS) o vacío (si no BS)
  const scriptPath = '/usr/src/scripts/ivr/recibir_cuentasmov.sh';

  let jsonArg;
  try {
    jsonArg = JSON.stringify(filteredData);
  } catch (e) {
    return res.status(200).json({
      code: upstreamCode,
      message: `${upstreamMessage} (No se pudo serializar JSON para el script)`,
      read: "",
      contador
    });
  }

  execFile('/bin/bash', [scriptPath, jsonArg], { timeout: 20000 }, (error, stdout, stderr) => {
    if (error) {
      console.error(`[recibir_cuentasmov] Script error:`, error.message);
      if (stderr) console.error(`[recibir_cuentasmov] stderr:`, stderr);
      return res.status(200).json({
        code: upstreamCode,
        message: `${upstreamMessage} (Script error: ${error.message})`,
        read: "",
        contador
      });
    }

    const readString = (stdout || '').toString().trim();

    return res.status(200).json({
      code: upstreamCode,      // el mismo del upstream
      message: upstreamMessage,
      read: readString,        // lo que diga el script con el JSON filtrado
      contador                 // cantidad tras el filtro por BS
    });
  });
});


// ⬇️ Recibir tarjetas: salidas → code, message, read, contador, info
app.post('/ivr/recibir-tarjetas', async (req, res) => {
  const { bearer, cliente, url } = req.body || {};
  // Validaciones básicas
  if (!bearer || !cliente || !url) {
    return res.status(400).json({
      code: 400,
      message: 'Parámetros requeridos: bearer, cliente, url',
      read: '',
      contador: 0,
      info: []
    });
  }

  let upstreamStatus = 0;
  let upstreamData = null;
  let upstreamMessage = 'OK';

  try {
    // Llamado al upstream
    const upstreamResp = await axios.post(
      url,
      { cliente },
      {
        headers: {
          'Authorization': `Bearer ${bearer}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        timeout: 15000,
      }
    );

    upstreamStatus = upstreamResp.status;
    upstreamData = upstreamResp.data;
    upstreamMessage =
      upstreamResp.data?.message ||
      upstreamResp.data?.msg ||
      `HTTP ${upstreamResp.status}`;
  } catch (err) {
    upstreamStatus = err.response?.status || 500;
    upstreamData = err.response?.data || { error: err.message };
    upstreamMessage =
      (err.response?.data && (err.response.data.message || err.response.data.error)) ||
      err.message ||
      'Error en conexión al upstream';

    // Devolver diagnóstico si falla el upstream
    return res.status(200).json({
      code: upstreamStatus,
      message: upstreamMessage,
      read: '',
      contador: 0,
      info: []
    });
  }

  // Extraer y filtrar tarjetas activas (estatusTarjeta === "1")
  const tarjetas = upstreamData?.data?.tarjetas;
  const activas = Array.isArray(tarjetas)
    ? tarjetas.filter(t => t && (t.estatusTarjeta === '1' || t.estatusTarjeta === 1))
    : [];

  const contador = activas.length;

  // Si no hay tarjetas activas, devolvemos sin llamar al script
  if (contador === 0) {
    return res.status(200).json({
      code: upstreamStatus,
      message: upstreamMessage,
      read: '',
      contador,
      info: activas
    });
  }

  // Ejecutar el script con solo las tarjetas activas
  const scriptPath = '/usr/src/scripts/ivr/recibir_tarjetas.sh';
  const payloadForScript = { data: { tarjetas: activas } };

  let jsonArg;
  try {
    jsonArg = JSON.stringify(payloadForScript);
  } catch (e) {
    return res.status(200).json({
      code: upstreamStatus,
      message: `${upstreamMessage} (No se pudo serializar JSON para el script)`,
      read: '',
      contador,
      info: activas
    });
  }

  execFile('/bin/bash', [scriptPath, jsonArg], { timeout: 15000 }, (error, stdout, stderr) => {
    if (error) {
      console.error(`[recibir_tarjetas] Script error:`, error.message);
      if (stderr) console.error(`[recibir_tarjetas] stderr:`, stderr);
      return res.status(200).json({
        code: upstreamStatus,
        message: `${upstreamMessage} (Script error: ${error.message})`,
        read: '',
        contador,
        info: activas
      });
    }

    const readString = (stdout || '').toString().trim();

    return res.status(200).json({
      code: upstreamStatus,
      message: upstreamMessage,
      read: readString,
      contador,
      info: activas
    });
  });
});

app.post('/ivr/recibir-tarjetasmov', async (req, res) => {
  const { bearer, cliente, url } = req.body || {};
  // Validaciones básicas
  if (!bearer || !cliente || !url) {
    return res.status(400).json({
      code: 400,
      message: 'Parámetros requeridos: bearer, cliente, url',
      read: '',
      contador: 0,
      info: []
    });
  }

  let upstreamStatus = 0;
  let upstreamData = null;
  let upstreamMessage = 'OK';

  try {
    // Llamado al upstream
    const upstreamResp = await axios.post(
      url,
      { cliente },
      {
        headers: {
          'Authorization': `Bearer ${bearer}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        timeout: 15000,
      }
    );

    upstreamStatus = upstreamResp.status;
    upstreamData = upstreamResp.data;
    upstreamMessage =
      upstreamResp.data?.message ||
      upstreamResp.data?.msg ||
      `HTTP ${upstreamResp.status}`;
  } catch (err) {
    upstreamStatus = err.response?.status || 500;
    upstreamData = err.response?.data || { error: err.message };
    upstreamMessage =
      (err.response?.data && (err.response.data.message || err.response.data.error)) ||
      err.message ||
      'Error en conexión al upstream';

    // Devolver diagnóstico si falla el upstream
    return res.status(200).json({
      code: upstreamStatus,
      message: upstreamMessage,
      read: '',
      contador: 0,
      info: []
    });
  }

  // Extraer y filtrar tarjetas activas (estatusTarjeta === "1")
  const tarjetas = upstreamData?.data?.tarjetas;
  const activas = Array.isArray(tarjetas)
    ? tarjetas.filter(t => t && (t.estatusTarjeta === '1' || t.estatusTarjeta === 1))
    : [];

  const contador = activas.length;

  // Si no hay tarjetas activas, devolvemos sin llamar al script
  if (contador === 0) {
    return res.status(200).json({
      code: upstreamStatus,
      message: upstreamMessage,
      read: '',
      contador,
      info: activas
    });
  }

  // Ejecutar el script con solo las tarjetas activas
  const scriptPath = '/usr/src/scripts/ivr/recibir_tarjetastdc_mov.sh';
  const payloadForScript = { data: { tarjetas: activas } };

  let jsonArg;
  try {
    jsonArg = JSON.stringify(payloadForScript);
  } catch (e) {
    return res.status(200).json({
      code: upstreamStatus,
      message: `${upstreamMessage} (No se pudo serializar JSON para el script)`,
      read: '',
      contador,
      info: activas
    });
  }

  execFile('/bin/bash', [scriptPath, jsonArg], { timeout: 15000 }, (error, stdout, stderr) => {
    if (error) {
      console.error(`[recibir_tarjetas] Script error:`, error.message);
      if (stderr) console.error(`[recibir_tarjetas] stderr:`, stderr);
      return res.status(200).json({
        code: upstreamStatus,
        message: `${upstreamMessage} (Script error: ${error.message})`,
        read: '',
        contador,
        info: activas
      });
    }

    const readString = (stdout || '').toString().trim();

    return res.status(200).json({
      code: upstreamStatus,
      message: upstreamMessage,
      read: readString,
      contador,
      info: activas
    });
  });
});

app.post('/ivr/recibir-tarjetaspagotdc', async (req, res) => {
  const { bearer, cliente, url } = req.body || {};

  // Validaciones básicas
  if (!bearer || !cliente || !url) {
    return res.status(400).json({
      code: 400,
      message: 'Parámetros requeridos: bearer, cliente, url',
      read: '',
      contador: 0,
      info: []
    });
  }

  let upstreamStatus = 0;
  let upstreamData = null;
  let upstreamMessage = 'OK';

  try {
    // Llamado al upstream
    const upstreamResp = await axios.post(
      url,
      { cliente },
      {
        headers: {
          'Authorization': `Bearer ${bearer}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        timeout: 15000,
      }
    );

    upstreamStatus = upstreamResp.status;
    upstreamData = upstreamResp.data;
    upstreamMessage =
      upstreamResp.data?.message ||
      upstreamResp.data?.msg ||
      `HTTP ${upstreamResp.status}`;
  } catch (err) {
    upstreamStatus = err.response?.status || 500;
    upstreamData = err.response?.data || { error: err.message };
    upstreamMessage =
      (err.response?.data && (err.response.data.message || err.response.data.error)) ||
      err.message ||
      'Error en conexión al upstream';

    // Devolver diagnóstico si falla el upstream
    return res.status(200).json({
      code: upstreamStatus,
      message: upstreamMessage,
      read: '',
      contador: 0,
      info: []
    });
  }

  // Extraer y filtrar tarjetas activas (estatusTarjeta === "1")
  const tarjetas = upstreamData?.data?.tarjetas;
  const activas = Array.isArray(tarjetas)
    ? tarjetas.filter(t => t && (t.estatusTarjeta === '1' || t.estatusTarjeta === 1))
    : [];

  const contador = activas.length;

  // Si no hay tarjetas activas, devolvemos sin llamar al script
  if (contador === 0) {
    return res.status(200).json({
      code: upstreamStatus,
      message: upstreamMessage,
      read: '',
      contador,
      info: activas
    });
  }

  // Ejecutar el script con solo las tarjetas activas
  const scriptPath = '/usr/src/scripts/ivr/recibir_tarjetaspagotdc.sh';
  const payloadForScript = { data: { tarjetas: activas } };

  let jsonArg;
  try {
    jsonArg = JSON.stringify(payloadForScript);
  } catch (e) {
    return res.status(200).json({
      code: upstreamStatus,
      message: `${upstreamMessage} (No se pudo serializar JSON para el script)`,
      read: '',
      contador,
      info: activas
    });
  }

  execFile('/bin/bash', [scriptPath, jsonArg], { timeout: 15000 }, (error, stdout, stderr) => {
    if (error) {
      console.error(`[recibir_tarjetas] Script error:`, error.message);
      if (stderr) console.error(`[recibir_tarjetas] stderr:`, stderr);
      return res.status(200).json({
        code: upstreamStatus,
        message: `${upstreamMessage} (Script error: ${error.message})`,
        read: '',
        contador,
        info: activas
      });
    }

    const readString = (stdout || '').toString().trim();

    return res.status(200).json({
      code: upstreamStatus,
      message: upstreamMessage,
      read: readString,
      contador,
      info: activas
    });
  });
});

// ⬇️ Consultar movimientos TDC: code, message, read, contador, info
app.post('/ivr/consultamovtdc', async (req, res) => {
  const { bearer, mes, anho, cuenta, tipoMovimiento, url } = req.body || {};
  if (!bearer || !mes || !anho || !cuenta || typeof tipoMovimiento === 'undefined' || !url) {
    return res.status(400).json({
      code: 400,
      message: 'Parámetros requeridos: bearer, mes, anho, cuenta, tipoMovimiento, url',
      read: '',
      contador: 0,
      info: {}
    });
  }

  // === audios fijos (sin rutas) ===
  const A_699  = `[2061]-1756331855004`;  // Los movimientos de su tarjeta son
  const A_1065 = `[1065]-1752614436461`;  // Crédito por
  const A_1066 = `[1066]-1752614437314`;  // Débito por
  const A_1026 = `[1026]-1754406097542`;  // Bolívares y
  const A_2056 = `[2056]-1754409695005`;  // céntimos
  const A_1067 = `[1067]-1752614438152`;  // con fecha
  const A_1080 = `[1080]-1752614449692`;  // primero (día 1)
  const A_1050 = `[1050]-1752614422776`;  // repetir
  const A_1029 = `[1029]-1752614405010`;  // menú anterior
  const A_1030 = `[1030]-1752614405921`;  // salir

  const MESES = {
    1: `[1068]-1752614439001`,  2: `[1069]-1752614439848`,
    3: `[1070]-1752614440702`,  4: `[1071]-1752614441551`,
    5: `[1072]-1752614442382`,  6: `[1073]-1752614443285`,
    7: `[1074]-1752614444152`,  8: `[1075]-1752614445113`,
    9: `[1076]-1752614446110`, 10: `[1077]-1752614446975`,
   11: `[1078]-1752614447930`, 12: `[1079]-1752614448871`
  };

  // ===== Helpers números =====

  // 0..999 usando audios dedicados: 0-99 (un solo archivo) y centenas
  const sayNumber999 = (n) => {
    n = Math.trunc(Number(n) || 0);
    if (n === 0) return '0';

    if (n < 100) return `${n}`;
    if (n === 100) return '100';

    if (n > 100 && n < 200) {
      const r = n - 100;
      return `ciento&${r}`;
    }

    const hundreds = Math.trunc(n / 100) * 100;
    const rest = n % 100;
    if (rest === 0) return `${hundreds}`;
    return `${hundreds}&${rest}`;
  };


// Grande: agrupa en tríos y agrega thousand/million(s)/billion(s),
// SIN decir "1" antes de mil/millón/billón (decimos "mil", "million", "billion").
const sayNumberLarge = (val) => {
  let n = Math.trunc(Number(val) || 0);
  if (n === 0) return `'0'`;

  // dividir en grupos de 3 dígitos (unidad, miles, millones, billones...)
  const groups = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.trunc(n / 1000);
  }

  const scaleName = (idx, groupVal) => {
    if (groupVal === 0) return '';
    switch (idx) {
      case 1: return `thousand`;                                  // miles
      case 2: return groupVal === 1 ? `million` : `millions`;    // millón(es)
      case 3: return groupVal === 1 ? `billion` : `billions`;    // billón(es)
      default: return '';
    }
  };

  const parts = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const gv = groups[i];
    if (gv === 0) continue;

    const suf = scaleName(i, gv);

    // i === 0 => grupo de unidades (sí se dice el "1")
    // i >= 1 => grupo de escala; si gv === 1, NO decimos "1", solo el sufijo
    let chunk = '';
    if (!(i >= 1 && gv === 1)) {
      // solo formamos el número del grupo si:
      // - es el grupo de unidades, o
      // - es un grupo de escala pero su valor != 1
      chunk = sayNumber999(gv);
    }

    // agregar el sufijo de escala si corresponde
    const piece = suf ? (chunk ? `${chunk}&${suf}` : `${suf}`) : chunk;
    if (piece) parts.push(piece);
  }

  return parts.join('&');
};


  // Split de monto y céntimos (2 dígitos)
  const splitAmount = (val) => {
    const num = Number(val);
    const fmt = Number.isFinite(num) ? num.toFixed(2) : '0.00';
    const [entero, cent] = fmt.split('.');
    return { entero, cent };
  };

  const tipoEsCredito = (tipo) => String(tipo || '').toUpperCase() === 'PG'; // PG=crédito

  const buildReadFromMovs = (movs) => {
    if (!Array.isArray(movs) || movs.length === 0) return '';
    const top = movs.slice(0, 10);
    const parts = [`${A_699}`];

    for (const m of top) {
      const head = tipoEsCredito(m.tipo) ? `${A_1065}` : `${A_1066}`;
      const { entero, cent } = splitAmount(m.monto || 0);

      // fecha del payload TDC (esperado: dia/mes)
      const diaNum = parseInt(m.dia || '0', 10);
      const mesNum = parseInt(m.mes || '0', 10);
      const diaAudio = (diaNum === 1) ? `${A_1080}` : sayNumber999(isNaN(diaNum) ? 0 : diaNum);
      const mesAudio = MESES[mesNum] ? `${MESES[mesNum]}` : `${MESES[1]}`;

      // monto entero grande + "Bolívares y" + céntimos (0 => '0')
      const enteroAudio = sayNumberLarge(entero);
      const centAudio = (cent === '00') ? `0` : sayNumber999(parseInt(cent, 10));

      const bloque = [
        head,
        enteroAudio,
        `${A_1026}`,
        centAudio,
        `${A_2056}`,
        `${A_1067}`,
        diaAudio,
        mesAudio
      ].join('&');

      parts.push(bloque);
    }

    parts.push(`${A_1050}&${A_1029}&${A_1030}`);
    return parts.join('&');
  };

  // === Llamada al upstream (dos intentos: mes actual y mes anterior) ===
  const callUpstream = async (payload) => {
    const resp = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 15000
    });
    return {
      status: resp.status,
      data: resp.data,
      message: resp.data?.message || resp.data?.msg || `HTTP ${resp.status}`
    };
  };

  // 1) intento con mes/anho recibidos
  let first;
  try {
    first = await callUpstream({ mes, anho, cuenta, tipoMovimiento });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.message || err.response?.data?.error || err.message || 'Error en conexión al upstream';
    return res.status(200).json({ code: status, message, read: '', contador: 0, info: err.response?.data || {} });
  }

  const movs1 = first.data?.data?.movimientos || [];
  if (Array.isArray(movs1) && movs1.length > 0) {
    const read = buildReadFromMovs(movs1);
    return res.status(200).json({
      code: first.status,
      message: first.message,
      read,
      contador: movs1.length,
      info: first.data
    });
  }

  // 2) intento con mes anterior (con rollover de año)
  const m = parseInt(mes, 10);
  const y = parseInt(anho, 10);
  let prevMes = isNaN(m) ? 1 : m;
  let prevAnho = isNaN(y) ? new Date().getFullYear() : y;

  prevMes = prevMes - 1;
  if (prevMes <= 0) { prevMes = 12; prevAnho = prevAnho - 1; }
  const prevMesStr = String(prevMes).padStart(2, '0');
  const prevAnhoStr = String(prevAnho);

  let second;
  try {
    second = await callUpstream({ mes: prevMesStr, anho: prevAnhoStr, cuenta, tipoMovimiento });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.message || err.response?.data?.error || err.message || 'Error en conexión al upstream';
    return res.status(200).json({ code: status, message, read: '', contador: 0, info: err.response?.data || {} });
  }

  const movs2 = second.data?.data?.movimientos || [];
  if (Array.isArray(movs2) && movs2.length > 0) {
    const read = buildReadFromMovs(movs2);
    return res.status(200).json({
      code: second.status,
      message: second.message,
      read,
      contador: movs2.length,
      info: second.data
    });
  }

  // Sin movimientos en ambos intentos
  return res.status(200).json({
    code: second.status,
    message: second.message,
    read: '',
    contador: 0,
    info: second.data
  });
});


app.listen(PORT, () => {
    console.log(`🟢 IVR env disponible en http://localhost:${PORT}/ivr/env`);
});
