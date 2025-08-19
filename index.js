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

    if (!ambiente || !['desa', 'prod'].includes(ambiente)) {
        return res.status(400).json({ error: 'Debe enviar el campo "ambiente" como "desa" o "prod".' });
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

      // ============ ACCIÓN: cuentas (v1) ============
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

        let contadorBS = 0;
        try {
          const arr = Array.isArray(upstreamData?.data) ? upstreamData.data : upstreamData?.data?.data || [];
          if (Array.isArray(arr)) contadorBS = arr.filter(x => x?.moneda === 'BS').length;
        } catch { contadorBS = 0; }

        const { out, error } = await runScript('/usr/src/scripts/ivr/recibir_cuentas.sh', upstreamData);
        if (error) {
          return res.status(200).json({ code: upstreamStatus, message: `${upstreamMessage} (${error})`, read: '', contador: contadorBS });
        }

        return res.status(200).json({
          code: upstreamStatus,
          message: upstreamMessage,
          read: out,
          contador: contadorBS,
          info: upstreamData   // ← NUEVO: info en éxito
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
          return res.status(400).json({ code: 400, message: 'Faltan: cuenta12, moneda, limite, paginas, bearer, url', read: '', contador: 0 });
        }

        let upstreamStatus, upstreamData, upstreamMessage;
        try {
          const { status, data, message } = await callUpstream({
            url, headers: { bearer }, payload: { cuenta12, moneda, limite, paginas }
          });
          upstreamStatus = status; upstreamData = data; upstreamMessage = message;
        } catch (err) {
          const status = err.response?.status || 500;
          const message = err.response?.data?.message || err.response?.data?.error || err.message || 'Error en conexión al upstream';
          return res.status(200).json({ code: status, message: read, read: '', contador: 0 });
        }

        let contadorReal = 0; let registrosBackend = 0;
        try { contadorReal = Array.isArray(upstreamData?.data?.movimientos) ? upstreamData.data.movimientos.length : 0; } catch {}
        try {
          const r = upstreamData?.data?.registros;
          registrosBackend = typeof r === 'string' ? parseInt(r, 10) : (Number.isFinite(r) ? r : 0);
        } catch {}

        const { out, error } = await runScript('/usr/src/scripts/ivr/recibir_cuentasmov.sh', upstreamData);
        if (error) {
          return res.status(200).json({ code: upstreamStatus, message: `${upstreamMessage} (${error})`, read: '', contador: contadorReal });
        }

        const codeFinal = (contadorReal === registrosBackend) ? upstreamStatus : '023';

        return res.status(200).json({
          code: codeFinal,
          message: upstreamMessage,
          read: out,
          contador: contadorReal,
          info: upstreamData   // ← NUEVO: info en éxito
        });
      }

      // ============ ACCIÓN: cuentasdeb ============
      // Filtra cuentas a SOLO moneda == "BS", pasa filtrado al script y devuelve info filtrado
      case 'cuentasdeb': {
        const { bearer, cedularif, url } = req.body || {};
        if (!bearer || !cedularif || !url) {
          return res.status(400).json({ code: 400, message: 'Faltan: bearer, cedularif, url', read: '', contador: 0, info: [] });
        }
      
        let upstreamStatus, upstreamData, upstreamMessage;
        try {
          const { status, data, message } = await (async () => {
            const resp = await axios.post(url, { cedularif }, {
              headers: {
                'Authorization': `Bearer ${bearer}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              timeout: 15000
            });
            return { status: resp.status, data: resp.data, message: resp.data?.message || resp.data?.msg || `HTTP ${resp.status}` };
          })();
      
          upstreamStatus = status;
          upstreamData = data;
          upstreamMessage = message;
        } catch (err) {
          const status = err.response?.status || 500;
          const message = err.response?.data?.message || err.response?.data?.error || err.message || 'Error en conexión al upstream';
          return res.status(200).json({ code: status, message, read: '', contador: 0, info: [] });
        }
      
        // Tomar array de cuentas del payload (soporta data o data.data)
        const arr = Array.isArray(upstreamData?.data) ? upstreamData.data
                  : (Array.isArray(upstreamData?.data?.data) ? upstreamData.data.data : []);
      
        // Filtrar SOLO cuentas en BS (case-insensitive por si viene en minúsculas)
        const bsOnly = arr.filter(x => String(x?.moneda || '').toUpperCase() === 'BS');
        const contadorBS = bsOnly.length;
      
        // Construir el objeto "info" conservando estructura original, pero con data filtrada
        const infoFiltrado = { ...upstreamData, data: bsOnly };
      
        // Ejecutar el script con SOLO cuentas BS (consistente con lo que se mostrará al usuario)
        const payloadForScript = infoFiltrado;
        let jsonArg;
        try {
          jsonArg = JSON.stringify(payloadForScript);
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

  // Validaciones básicas
  if (!cuenta12 || !moneda || typeof limite === 'undefined' || typeof paginas === 'undefined' || !bearer || !url) {
    return res.status(400).json({
      code: 400,
      message: "Parámetros requeridos: cuenta12, moneda, limite, paginas, bearer, url",
      read: "",
      contador: 0
    });
  }

  let upstreamStatus = 0;
  let upstreamData = null;
  let upstreamMessage = "OK";

  try {
    // Llamado al upstream (API de movimientos)
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

    upstreamStatus = upstreamResp.status;
    upstreamData = upstreamResp.data; // ← respuesta CRUDA
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

    // En caso de fallo upstream, respondemos ya con diagnóstico (no llamamos al script)
    return res.status(200).json({
      code: upstreamStatus,
      message: upstreamMessage,
      read: "",
      contador: 0
    });
  }

  // Contador real de movimientos en el payload
  let contadorReal = 0;
  try {
    const movimientos = upstreamData?.data?.movimientos;
    contadorReal = Array.isArray(movimientos) ? movimientos.length : 0;
  } catch (_) {
    contadorReal = 0;
  }

  // 'registros' reportado por el backend (puede venir como string)
  let registrosBackend = 0;
  try {
    const r = upstreamData?.data?.registros;
    registrosBackend = typeof r === 'string' ? parseInt(r, 10) : (Number.isFinite(r) ? r : 0);
  } catch (_) {
    registrosBackend = 0;
  }

  // Ejecutar el script con la RESPUESTA CRUDA
  const scriptPath = '/usr/src/scripts/ivr/recibir_cuentasmov.sh';

  let jsonArg;
  try {
    jsonArg = JSON.stringify(upstreamData); // ← crudo
  } catch (e) {
    return res.status(200).json({
      code: upstreamStatus,
      message: `${upstreamMessage} (No se pudo serializar JSON para el script)`,
      read: "",
      contador: contadorReal
    });
  }

  execFile('/bin/bash', [scriptPath, jsonArg], { timeout: 20000 }, (error, stdout, stderr) => {
    if (error) {
      console.error(`[recibir_cuentasmov] Script error:`, error.message);
      if (stderr) console.error(`[recibir_cuentasmov] stderr:`, stderr);
      return res.status(200).json({
        code: upstreamStatus,
        message: `${upstreamMessage} (Script error: ${error.message})`,
        read: "",
        contador: contadorReal
      });
    }

    const readString = (stdout || '').toString().trim();

    // Si contador real y 'registros' difieren → code = '023'
    const codeFinal = (contadorReal === registrosBackend) ? upstreamStatus : '023';

    return res.status(200).json({
      code: codeFinal,
      message: upstreamMessage,
      read: readString,
      contador: contadorReal
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


app.listen(PORT, () => {
    console.log(`🟢 IVR env disponible en http://localhost:${PORT}/ivr/env`);
});
