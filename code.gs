  /**
  * Q Berries — Grupo de Cosecha
  * ZONAS EN FILAS (no columnas) — fácil de leer con 1 o 20 zonas
  *
  * Por cada conteo se escriben (en este orden fijo):
  *  N filas ZONA     → una fila por zona con cantidad
  *  1 fila PERSONAL  → roles, total y almuerzos/permisos/faltas (siempre al final)
  */

  var TZ = 'America/Lima';
  var HOJA = 'Hoja 1';

  var COLUMNAS = [
    'Hora Registro',
    'Grupo Cosecha', 'Supervisor', 'Fecha',
    'Lote Mod Turno', 'Cod Lote', 'Variedad',
    'Tipo', 'Zona', 'Cantidad',
    'Cosechadores', 'Escaner', 'Calidad', 'Cant Supervisor', 'Total Personal',
    'Almuerzos', 'Permisos', 'Faltas'
  ];

  function doGet(e) {
    return responder_(procesar_(e, 'GET'));
  }

  function doPost(e) {
    return responder_(procesar_(e, 'POST'));
  }

  function procesar_(e, metodo) {
    try {
      if (!validarToken_(e)) {
        return { ok: false, code: 'UNAUTHORIZED', message: 'Token inválido' };
      }

      var action = param_(e, 'action') || '';
      var body = {};

      if (metodo === 'POST' && e.postData && e.postData.contents) {
        try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
        if (body.action) action = body.action;
      }

      if (action === 'ping') return { ok: true, message: 'pong' };
      if (action === 'guardar') return guardar_(body.data || body);

      return { ok: false, message: 'Acción no válida. Use: ping o guardar' };
    } catch (err) {
      return { ok: false, message: String(err.message || err) };
    }
  }

  function guardar_(d) {
    d = d || {};
    var localId = String(d.localId || '').trim();

    if (localId && yaGuardado_(localId)) {
      return {
        ok: true,
        duplicate: true,
        message: 'Conteo ya registrado (sin duplicar)'
      };
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      return { ok: false, message: 'Servidor ocupado — reintente' };
    }

    try {
      if (localId && yaGuardado_(localId)) {
        return {
          ok: true,
          duplicate: true,
          message: 'Conteo ya registrado (sin duplicar)'
        };
      }

      var hoja = obtenerHoja_();
      asegurarEncabezados_(hoja);

      var base = {
        horaRegistro: d.horaRegistro || hora_(),
        grupoCosecha: num_(d.grupoCosecha),
        supervisor: texto_(d.supervisor),
        fecha: d.fecha || hoy_(),
        loteModTurno: loteModTurno_(d),
        codLote: texto_(d.codLote),
        variedad: texto_(d.variedad)
      };

      var cosechadores = num_(d.cosechadores);
      var escaner = num_(d.escaner);
      var calidad = num_(d.calidad);
      var supervisorCount = num_(d.supervisorCount);
      var totalPersonal = cosechadores + escaner + calidad + supervisorCount;

      var zonas = d.distribucionZonas || [];
      var filas = [];

      for (var i = 0; i < zonas.length; i++) {
        var z = zonas[i];
        var nombre = texto_(z.zona);
        var cant = num_(z.cantidad);
        if (!nombre || cant <= 0) continue;
        filas.push(fila_(base, 'ZONA', nombre, cant, {
          cosechadores: '', escaner: '', calidad: '', supervisorCount: '',
          totalPersonal: '', almuerzos: '', permisos: '', faltas: ''
        }));
      }

      filas.push(fila_(base, 'PERSONAL', '', '', {
        cosechadores: cosechadores,
        escaner: escaner,
        calidad: calidad,
        supervisorCount: supervisorCount,
        totalPersonal: totalPersonal,
        almuerzos: num_(d.almuerzos),
        permisos: num_(d.permisos),
        faltas: num_(d.faltas)
      }));

      var primera = hoja.getLastRow() + 1;
      for (var j = 0; j < filas.length; j++) {
        hoja.appendRow(filas[j]);
      }

      if (localId) marcarGuardado_(localId);

      return {
        ok: true,
        filas: filas.length,
        desde: primera,
        hasta: hoja.getLastRow(),
        message: 'Guardado — ' + filas.length + ' filas · Total ' + totalPersonal + ' pers.'
      };
    } finally {
      lock.releaseLock();
    }
  }

  function yaGuardado_(localId) {
    return CacheService.getScriptCache().get('lid_' + localId) !== null;
  }

  function marcarGuardado_(localId) {
    CacheService.getScriptCache().put('lid_' + localId, '1', 21600);
  }

  function fila_(base, tipo, zona, cantidad, extra) {
    extra = extra || {};
    return [
      base.horaRegistro,
      base.grupoCosecha,
      base.supervisor,
      base.fecha,
      base.loteModTurno,
      base.codLote,
      base.variedad,
      tipo,
      zona,
      cantidad === '' ? '' : num_(cantidad),
      extra.cosechadores === '' ? '' : num_(extra.cosechadores),
      extra.escaner === '' ? '' : num_(extra.escaner),
      extra.calidad === '' ? '' : num_(extra.calidad),
      extra.supervisorCount === '' ? '' : num_(extra.supervisorCount),
      extra.totalPersonal === '' ? '' : num_(extra.totalPersonal),
      extra.almuerzos === '' ? '' : num_(extra.almuerzos),
      extra.permisos === '' ? '' : num_(extra.permisos),
      extra.faltas === '' ? '' : num_(extra.faltas)
    ];
  }

  function asegurarEncabezados_(hoja) {
    var lastRow = hoja.getLastRow();
    var lastCol = Math.max(hoja.getLastColumn(), 1);

    if (lastRow === 0) {
      hoja.appendRow(COLUMNAS);
      estilizarEncabezados_(hoja, COLUMNAS.length);
      return;
    }

    var headers = limpiarHeaders_(hoja.getRange(1, 1, 1, lastCol).getValues()[0]);
    var ok = headers.length === COLUMNAS.length && headers[7] === 'Tipo' && headers[8] === 'Zona';

    if (ok) return;

    if (lastRow <= 1) {
      hoja.clear();
      hoja.appendRow(COLUMNAS);
    } else {
      hoja.insertRowBefore(1);
      hoja.getRange(1, 1, 1, COLUMNAS.length).setValues([COLUMNAS]);
    }
    estilizarEncabezados_(hoja, COLUMNAS.length);
  }

  function loteModTurno_(d) {
    var partes = [];
    var lote = texto_(d.lote);
    var mod = num_(d.modulo);
    var turno = num_(d.turno);
    if (lote) partes.push('L' + lote);
    if (mod) partes.push('M' + mod);
    if (turno) partes.push('T' + turno);
    return partes.join(' · ');
  }

  function limpiarHeaders_(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var v = String(arr[i] || '').trim();
      if (v) out.push(v);
    }
    return out;
  }

  function estilizarEncabezados_(hoja, numCols) {
    hoja.getRange(1, 1, 1, numCols)
      .setFontWeight('bold')
      .setBackground('#5B9BD5')
      .setFontColor('#FFFFFF');
    hoja.setFrozenRows(1);
  }

  function obtenerHoja_() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var h = ss.getSheetByName(HOJA);
    return h || ss.getSheets()[0];
  }

  function validarToken_(e) {
    var esperado = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (!esperado) return true;
    var token = param_(e, 'token') || '';
    if (!token && e.postData && e.postData.contents) {
      try { token = JSON.parse(e.postData.contents).token || ''; } catch (err) {}
    }
    return token === esperado;
  }

  function param_(e, key) {
    if (!e || !e.parameter) return '';
    return e.parameter[key] != null ? String(e.parameter[key]) : '';
  }

  function num_(v) {
    var n = parseInt(v, 10);
    return isNaN(n) ? 0 : Math.max(0, n);
  }

  function texto_(v) {
    return String(v || '').trim().toUpperCase();
  }

  function hoy_() {
    return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  }

  function hora_() {
    return Utilities.formatDate(new Date(), TZ, 'HH:mm:ss');
  }

  function responder_(obj) {
    return ContentService
      .createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
  }
