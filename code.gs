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
      if (action === 'dashboard') {
        var fechaDash = body.fecha || param_(e, 'fecha') || '';
        return dashboard_(fechaDash);
      }

      return { ok: false, message: 'Acción no válida. Use: ping, guardar o dashboard' };
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
      invalidarDashboardCache_();

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

  /**
   * Resumen desde Sheet (rápido):
   * - Cache servidor ~90s por fecha
   * - Filas PERSONAL → roles (col K=Cosechadores …)
   * - Filas ZONA → personas por zona
   * fecha vacío = hoy; "all" = todas las fechas
   */
  function dashboard_(fechaFiltro) {
    var filtro = String(fechaFiltro || '').trim();
    if (!filtro) filtro = hoy_();
    var todas = filtro.toLowerCase() === 'all' || filtro === '*';
    var cacheKey = 'dash_v2_' + (todas ? 'all' : filtro);

    var cache = CacheService.getScriptCache();
    try {
      var cached = cache.get(cacheKey);
      if (cached) {
        var parsed = JSON.parse(cached);
        if (parsed && parsed.ok) {
          parsed.fromCache = true;
          return parsed;
        }
      }
    } catch (e) { /* sin cache */ }

    var hoja = obtenerHoja_();
    var lastRow = hoja.getLastRow();
    if (lastRow < 2) {
      var vacio = {
        ok: true,
        fecha: todas ? 'all' : filtro,
        totales: vaciosTotales_(),
        supervisores: [],
        zonas: [],
        conteos: 0,
        generatedAt: new Date().toISOString()
      };
      try { cache.put(cacheKey, JSON.stringify(vacio), 90); } catch (e2) {}
      return vacio;
    }

    // Solo columnas usadas: B..Q (2..17) = índices 1..16 en array 0-based de getRange col 2
    // Leemos A..R completo una sola vez (rápido en Sheets)
    var data = hoja.getRange(2, 1, lastRow, COLUMNAS.length).getValues();

    var bySup = {};
    var byZona = {};
    var totales = vaciosTotales_();
    var conteos = 0;

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var tipo = String(row[7] || '').trim().toUpperCase();
      if (tipo !== 'PERSONAL' && tipo !== 'ZONA') continue;

      var fecha = normalizarFecha_(row[3]);
      if (!todas && fecha !== filtro) continue;

      if (tipo === 'PERSONAL') {
        var nombre = String(row[2] || '').trim().toUpperCase() || 'SIN NOMBRE';
        var cos = num_(row[10]);
        var esc = num_(row[11]);
        var cal = num_(row[12]);
        var supC = num_(row[13]);
        var tot = num_(row[14]) || (cos + esc + cal + supC);
        var grupo = String(row[1] || '').trim();

        if (!bySup[nombre]) {
          bySup[nombre] = {
            supervisor: nombre,
            cosechadores: 0,
            escaner: 0,
            calidad: 0,
            supervisorCount: 0,
            total: 0,
            conteos: 0,
            grupos: {}
          };
        }
        var s = bySup[nombre];
        s.cosechadores += cos;
        s.escaner += esc;
        s.calidad += cal;
        s.supervisorCount += supC;
        s.total += tot;
        s.conteos += 1;
        if (grupo) s.grupos[grupo] = true;

        totales.cosechadores += cos;
        totales.escaner += esc;
        totales.calidad += cal;
        totales.supervisorCount += supC;
        totales.total += tot;
        totales.almuerzos += num_(row[15]);
        totales.permisos += num_(row[16]);
        totales.faltas += num_(row[17]);
        conteos += 1;
      } else {
        var zona = String(row[8] || '').trim().toUpperCase();
        var cant = num_(row[9]);
        if (!zona || cant <= 0) continue;
        byZona[zona] = (byZona[zona] || 0) + cant;
      }
    }

    var supervisores = [];
    for (var key in bySup) {
      if (!bySup.hasOwnProperty(key)) continue;
      var item = bySup[key];
      var nGrupos = 0;
      for (var g in item.grupos) {
        if (item.grupos.hasOwnProperty(g)) nGrupos++;
      }
      supervisores.push({
        supervisor: item.supervisor,
        cosechadores: item.cosechadores,
        escaner: item.escaner,
        calidad: item.calidad,
        supervisorCount: item.supervisorCount,
        total: item.total,
        conteos: item.conteos,
        grupos: nGrupos
      });
    }
    supervisores.sort(function (a, b) {
      return b.cosechadores - a.cosechadores || b.total - a.total;
    });

    var zonas = [];
    for (var z in byZona) {
      if (!byZona.hasOwnProperty(z)) continue;
      zonas.push({ zona: z, cantidad: byZona[z] });
    }
    zonas.sort(function (a, b) {
      return b.cantidad - a.cantidad;
    });

    totales.supervisoresUnicos = supervisores.length;
    totales.conteos = conteos;

    var result = {
      ok: true,
      fecha: todas ? 'all' : filtro,
      totales: totales,
      supervisores: supervisores,
      zonas: zonas,
      conteos: conteos,
      generatedAt: new Date().toISOString(),
      fromCache: false
    };

    try {
      cache.put(cacheKey, JSON.stringify(result), 90);
    } catch (e3) { /* payload grande */ }

    return result;
  }

  function invalidarDashboardCache_() {
    try {
      var cache = CacheService.getScriptCache();
      cache.remove('dash_v2_' + hoy_());
      cache.remove('dash_v2_all');
    } catch (e) { /* ok */ }
  }

  function vaciosTotales_() {
    return {
      cosechadores: 0,
      escaner: 0,
      calidad: 0,
      supervisorCount: 0,
      total: 0,
      almuerzos: 0,
      permisos: 0,
      faltas: 0,
      supervisoresUnicos: 0,
      conteos: 0
    };
  }

  function normalizarFecha_(v) {
    if (v instanceof Date && !isNaN(v.getTime())) {
      return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
    }
    var s = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return s;
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
