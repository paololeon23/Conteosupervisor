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
    'Grupo Cosecha', 'DNI', 'Supervisor', 'Fecha',
    'Lote Mod Turno', 'Cod Lote', 'Variedad',
    'Tipo', 'Zona', 'Cantidad',
    'Cosechadores', 'Escaner', 'Calidad', 'Cant Supervisor', 'Total Personal',
    'Almuerzos', 'Permisos', 'Faltas'
  ];

  // Índices de columna (0-based) — formato con DNI separado
  var COL = {
    HORA: 0,
    GRUPO: 1,
    DNI: 2,
    SUPERVISOR: 3,
    FECHA: 4,
    LOTE_MOD: 5,
    COD_LOTE: 6,
    VARIEDAD: 7,
    TIPO: 8,
    ZONA: 9,
    CANTIDAD: 10,
    COSECHADORES: 11,
    ESCANER: 12,
    CALIDAD: 13,
    CANT_SUP: 14,
    TOTAL: 15,
    ALMUERZOS: 16,
    PERMISOS: 17,
    FALTAS: 18
  };

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

      if (action === 'ping') {
        return {
          ok: true,
          message: 'pong',
          hoy: hoy_(),
          tz: TZ,
          hoja: obtenerHoja_().getName()
        };
      }
      if (action === 'guardar') return guardar_(body.data || body);
      if (action === 'consultar') return consultar_(body.data || body);
      if (action === 'dashboard') {
        var fechaDash = body.fecha || param_(e, 'fecha') || '';
        return dashboard_(fechaDash);
      }

      return { ok: false, message: 'Acción no válida. Use: ping, guardar, consultar o dashboard' };
    } catch (err) {
      return { ok: false, message: String(err.message || err) };
    }
  }

  function guardar_(d) {
    d = d || {};
    var localId = String(d.localId || '').trim();
    var editar = d.editar === true || d.editar === 'true' || d.editar === 1;

    if (!editar && localId && yaGuardado_(localId)) {
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
      if (!editar && localId && yaGuardado_(localId)) {
        return {
          ok: true,
          duplicate: true,
          message: 'Conteo ya registrado (sin duplicar)'
        };
      }

      var hoja = obtenerHoja_();
      asegurarEncabezados_(hoja);

      var dni = limpiarDni_(d.codSupervisor || d.dni || extraerDni_(d.supervisor));
      var nombreSup = texto_(nombreSinDni_(d.supervisor) || d.supervisorNombre || '');
      if (!dni) {
        return { ok: false, message: 'Falta DNI del supervisor' };
      }
      if (!nombreSup) nombreSup = 'SUPERVISOR ' + dni;

      var fecha = d.fecha || hoy_();

      // Si ya hay filas de este DNI + fecha → borrar y reescribir (editar)
      var filasPrevias = buscarFilasSupFecha_(hoja, dni, fecha);
      var actualizado = filasPrevias.length > 0;
      if (actualizado) {
        borrarFilas_(hoja, filasPrevias);
      }

      var base = {
        horaRegistro: d.horaRegistro || hora_(),
        grupoCosecha: num_(d.grupoCosecha),
        dni: dni,
        supervisor: nombreSup,
        fecha: fecha,
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
        updated: actualizado,
        filas: filas.length,
        desde: primera,
        hasta: hoja.getLastRow(),
        message: (actualizado ? 'Actualizado' : 'Guardado') +
          ' — ' + filas.length + ' filas · Total ' + totalPersonal + ' pers.'
      };
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * ¿Este DNI ya marcó en la fecha? Devuelve el último conteo para editar.
   */
  function consultar_(d) {
    d = d || {};
    var dni = limpiarDni_(d.codSupervisor || d.dni || '');
    var fecha = d.fecha || hoy_();
    if (!dni) return { ok: false, message: 'Falta DNI' };

    var hoja = obtenerHoja_();
    asegurarEncabezados_(hoja);
    var lastRow = hoja.getLastRow();
    if (lastRow < 2) {
      return { ok: true, existe: false, fecha: fecha, codSupervisor: dni };
    }

    var data = hoja.getRange(2, 1, lastRow, COLUMNAS.length).getValues();
    var personal = null;
    var zonas = [];
    var batchKey = '';

    // Buscar el PERSONAL más reciente de este DNI + fecha
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var tipo = String(row[COL.TIPO] || '').trim().toUpperCase();
      if (tipo !== 'PERSONAL') continue;
      var fechaRow = normalizarFecha_(row[COL.FECHA]);
      if (fechaRow !== fecha) continue;
      if (!filaEsDni_(row, dni)) continue;

      personal = row;
      batchKey = batchKey_(row);
      zonas = [];
    }

    if (!personal) {
      return { ok: true, existe: false, fecha: fecha, codSupervisor: dni };
    }

    // Zonas del mismo lote de registro (mismo grupo+dni+fecha+hora)
    for (var j = 0; j < data.length; j++) {
      var r = data[j];
      if (String(r[COL.TIPO] || '').trim().toUpperCase() !== 'ZONA') continue;
      if (batchKey_(r) !== batchKey) continue;
      var zonaNom = String(r[COL.ZONA] || '').trim().toUpperCase();
      var cant = num_(r[COL.CANTIDAD]);
      if (zonaNom && cant > 0) zonas.push({ zona: zonaNom, cantidad: cant });
    }

    var lmt = parseLoteModTurno_(personal[COL.LOTE_MOD]);
    var nombreSup = String(personal[COL.SUPERVISOR] || '').trim();

    return {
      ok: true,
      existe: true,
      fecha: fecha,
      codSupervisor: dni,
      data: {
        grupoCosecha: String(personal[COL.GRUPO] || '').trim(),
        supervisor: nombreSup,
        supervisorNombre: nombreSup,
        codSupervisor: dni,
        dni: dni,
        fecha: fecha,
        lote: lmt.lote,
        modulo: lmt.modulo,
        turno: lmt.turno,
        codLote: String(personal[COL.COD_LOTE] || '').trim(),
        variedad: String(personal[COL.VARIEDAD] || '').trim(),
        cosechadores: num_(personal[COL.COSECHADORES]),
        escaner: num_(personal[COL.ESCANER]),
        calidad: num_(personal[COL.CALIDAD]),
        supervisorCount: num_(personal[COL.CANT_SUP]),
        almuerzos: num_(personal[COL.ALMUERZOS]),
        permisos: num_(personal[COL.PERMISOS]),
        faltas: num_(personal[COL.FALTAS]),
        distribucionZonas: zonas,
        horaRegistro: String(personal[COL.HORA] || '').trim()
      }
    };
  }

  function batchKey_(row) {
    return [
      String(row[COL.HORA] || ''),
      String(row[COL.GRUPO] || ''),
      String(row[COL.DNI] || ''),
      normalizarFecha_(row[COL.FECHA])
    ].join('|');
  }

  /** row = fila completa; acepta formato nuevo (col DNI) o viejo combinado */
  function filaEsDni_(rowOrCell, dni) {
    if (!dni) return false;
    if (Array.isArray(rowOrCell)) {
      var dniCell = limpiarDni_(rowOrCell[COL.DNI]);
      if (dniCell && dniCell === dni) return true;
      var nomCell = String(rowOrCell[COL.SUPERVISOR] || '').trim();
      if (limpiarDni_(extraerDni_(nomCell)) === dni) return true;
      if (String(nomCell).indexOf(dni) === 0) return true;
      return false;
    }
    var s = String(rowOrCell || '').trim();
    if (!s) return false;
    if (limpiarDni_(s) === dni) return true;
    if (s.indexOf(dni) === 0) return true;
    return limpiarDni_(extraerDni_(s)) === dni;
  }

  function buscarFilasSupFecha_(hoja, dni, fecha) {
    var lastRow = hoja.getLastRow();
    if (lastRow < 2) return [];
    var data = hoja.getRange(2, 1, lastRow, COL.TIPO + 1).getValues();
    var indices = [];
    for (var i = 0; i < data.length; i++) {
      var tipo = String(data[i][COL.TIPO] || '').trim().toUpperCase();
      if (tipo !== 'ZONA' && tipo !== 'PERSONAL') continue;
      if (normalizarFecha_(data[i][COL.FECHA]) !== fecha) continue;
      if (!filaEsDni_(data[i], dni)) continue;
      indices.push(i + 2);
    }
    return indices;
  }

  function borrarFilas_(hoja, indices) {
    indices = indices.slice().sort(function (a, b) { return b - a; });
    for (var i = 0; i < indices.length; i++) {
      hoja.deleteRow(indices[i]);
    }
  }

  function limpiarDni_(v) {
    return String(v || '').replace(/\D/g, '').substring(0, 9);
  }

  function extraerDni_(supervisorField) {
    var s = String(supervisorField || '').trim();
    var m = s.match(/^(\d{8,9})\b/);
    return m ? m[1] : '';
  }

  function nombreSinDni_(supervisorField) {
    var s = String(supervisorField || '').trim();
    var m = s.match(/^\d{8,9}\s*[·\-\u2013]?\s*(.+)$/);
    return m ? m[1].trim() : s;
  }

  function parseLoteModTurno_(raw) {
    var s = String(raw || '');
    var lote = '';
    var modulo = '';
    var turno = '';
    var ml = s.match(/L\s*([0-9A-Za-z]+)/i);
    var mm = s.match(/M\s*(\d+)/i);
    var mt = s.match(/T\s*(\d+)/i);
    if (ml) lote = ml[1];
    if (mm) modulo = mm[1];
    if (mt) turno = mt[1];
    return { lote: lote, modulo: modulo, turno: turno };
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
   * - Filas PERSONAL → roles
   * - Filas ZONA → personas por zona
   * fecha vacío / "hoy" = hoy Lima; "all" = todas las fechas
   */
  function dashboard_(fechaFiltro) {
    var filtroRaw = String(fechaFiltro || '').trim();
    var todas = filtroRaw.toLowerCase() === 'all' || filtroRaw === '*';
    var filtro = todas ? 'all' : resolverFechaFiltro_(filtroRaw);
    var cacheKey = 'dash_v4_' + (todas ? 'all' : filtro);

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
    asegurarEncabezados_(hoja);
    var lastRow = hoja.getLastRow();
    if (lastRow < 2) {
      var vacio = armarResultado_(todas ? 'all' : filtro, vaciosTotales_(), [], [], 0, {
        hoyServidor: hoy_(),
        fechasEncontradas: [],
        filasLeidas: 0,
        filasOmitidasPorFecha: 0,
        hoja: hoja.getName()
      });
      try { cache.put(cacheKey, JSON.stringify(vacio), 90); } catch (e2) {}
      return vacio;
    }

    var data = hoja.getRange(2, 1, lastRow, COLUMNAS.length).getValues();
    var bySup = {};
    var byZona = {};
    var totales = vaciosTotales_();
    var conteos = 0;
    var fechasMap = {};
    var filasLeidas = 0;
    var omitidas = 0;

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var tipo = String(row[COL.TIPO] || '').trim().toUpperCase();
      if (tipo !== 'PERSONAL' && tipo !== 'ZONA') continue;

      filasLeidas++;
      var fecha = normalizarFecha_(row[COL.FECHA]);
      if (fecha) fechasMap[fecha] = true;

      if (!todas && fecha !== filtro) {
        omitidas++;
        continue;
      }

      if (tipo === 'PERSONAL') {
        var dniSup = limpiarDni_(row[COL.DNI]);
        var nombre = String(row[COL.SUPERVISOR] || '').trim().toUpperCase();
        if (!nombre && !dniSup) nombre = 'SIN NOMBRE';
        // Etiqueta compatible con el cliente (match por DNI o nombre)
        var label = dniSup ? (dniSup + ' · ' + (nombre || dniSup)) : nombre;
        var key = dniSup || label;

        var cos = num_(row[COL.COSECHADORES]);
        var esc = num_(row[COL.ESCANER]);
        var cal = num_(row[COL.CALIDAD]);
        var supC = num_(row[COL.CANT_SUP]);
        var tot = num_(row[COL.TOTAL]) || (cos + esc + cal + supC);
        var grupo = String(row[COL.GRUPO] || '').trim();

        if (!bySup[key]) {
          bySup[key] = {
            supervisor: label,
            cosechadores: 0,
            escaner: 0,
            calidad: 0,
            supervisorCount: 0,
            total: 0,
            conteos: 0,
            grupos: {}
          };
        }
        var s = bySup[key];
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
        totales.almuerzos += num_(row[COL.ALMUERZOS]);
        totales.permisos += num_(row[COL.PERMISOS]);
        totales.faltas += num_(row[COL.FALTAS]);
        conteos += 1;
      } else {
        var zona = String(row[COL.ZONA] || '').trim().toUpperCase();
        var cant = num_(row[COL.CANTIDAD]);
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

    var fechasEncontradas = [];
    for (var f in fechasMap) {
      if (fechasMap.hasOwnProperty(f)) fechasEncontradas.push(f);
    }
    fechasEncontradas.sort();

    var result = armarResultado_(todas ? 'all' : filtro, totales, supervisores, zonas, conteos, {
      hoyServidor: hoy_(),
      fechasEncontradas: fechasEncontradas,
      filasLeidas: filasLeidas,
      filasOmitidasPorFecha: omitidas,
      hoja: hoja.getName(),
      soloHoyEnBase: !todas && fechasEncontradas.length === 1 && fechasEncontradas[0] === filtro
    });

    try {
      cache.put(cacheKey, JSON.stringify(result), 90);
    } catch (e3) { /* payload grande */ }

    return result;
  }

  function resolverFechaFiltro_(raw) {
    var s = String(raw || '').trim().toLowerCase();
    if (!s || s === 'hoy' || s === 'today') return hoy_();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    var n = normalizarFecha_(raw);
    return n || hoy_();
  }

  function armarResultado_(fecha, totales, supervisores, zonas, conteos, meta) {
    return {
      ok: true,
      fecha: fecha,
      totales: totales,
      supervisores: supervisores,
      zonas: zonas,
      conteos: conteos,
      generatedAt: new Date().toISOString(),
      fromCache: false,
      meta: meta || {}
    };
  }

  function invalidarDashboardCache_() {
    try {
      var cache = CacheService.getScriptCache();
      cache.remove('dash_v4_' + hoy_());
      cache.remove('dash_v4_all');
      cache.remove('dash_v3_' + hoy_());
      cache.remove('dash_v3_all');
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

  /** Normaliza fechas de Sheet (Date, serial, texto) a yyyy-MM-dd en TZ Lima / hoja */
  function normalizarFecha_(v) {
    var ssTz = TZ;
    try {
      ssTz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || TZ;
    } catch (e) { /* ok */ }

    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
      return Utilities.formatDate(v, ssTz, 'yyyy-MM-dd');
    }

    if (typeof v === 'number' && isFinite(v) && v > 20000 && v < 80000) {
      // Serial de Google Sheets
      var epoch = new Date(Date.UTC(1899, 11, 30));
      var asDate = new Date(epoch.getTime() + Math.round(v) * 86400000);
      return Utilities.formatDate(asDate, 'UTC', 'yyyy-MM-dd');
    }

    var s = String(v || '').trim();
    if (!s) return '';

    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];

    var dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if (dmy) {
      var dd = ('0' + dmy[1]).slice(-2);
      var mm = ('0' + dmy[2]).slice(-2);
      return dmy[3] + '-' + mm + '-' + dd;
    }

    // Último intento: parsear como Date
    var parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      return Utilities.formatDate(parsed, ssTz, 'yyyy-MM-dd');
    }

    return s;
  }

  function fila_(base, tipo, zona, cantidad, extra) {
    extra = extra || {};
    return [
      base.horaRegistro,
      base.grupoCosecha,
      base.dni,
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

    // Formato nuevo: DNI | Supervisor | … | Tipo
    if (headers[2] === 'DNI' && headers[3] === 'Supervisor' && headers[8] === 'Tipo') {
      return;
    }

    // Formato viejo: Supervisor combinado (sin col DNI) → migrar
    if (headers[2] === 'Supervisor' && headers[7] === 'Tipo') {
      migrarSepararDni_(hoja);
      return;
    }

    if (lastRow <= 1) {
      hoja.clear();
      hoja.appendRow(COLUMNAS);
    } else {
      hoja.insertRowBefore(1);
      hoja.getRange(1, 1, 1, COLUMNAS.length).setValues([COLUMNAS]);
    }
    estilizarEncabezados_(hoja, COLUMNAS.length);
  }

  /** Inserta col DNI y parte "75075892 · NOMBRE" en DNI + Supervisor */
  function migrarSepararDni_(hoja) {
    hoja.insertColumnAfter(2); // nueva col C = DNI; viejo Supervisor pasa a D
    var lastRow = hoja.getLastRow();
    hoja.getRange(1, 1, 1, COLUMNAS.length).setValues([COLUMNAS]);
    estilizarEncabezados_(hoja, COLUMNAS.length);

    if (lastRow < 2) {
      invalidarDashboardCache_();
      return;
    }

    var range = hoja.getRange(2, 3, lastRow, 4); // C–D
    var values = range.getValues();
    for (var i = 0; i < values.length; i++) {
      var combinado = String(values[i][1] || '').trim();
      if (!combinado && !values[i][0]) continue;
      var dni = limpiarDni_(extraerDni_(combinado) || values[i][0]);
      var nombre = texto_(nombreSinDni_(combinado));
      values[i][0] = dni;
      values[i][1] = nombre;
    }
    range.setValues(values);
    invalidarDashboardCache_();
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
