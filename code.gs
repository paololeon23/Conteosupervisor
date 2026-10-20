    /**
    * Q Berries — Grupo de Cosecha
    * ZONAS EN FILAS (no columnas) — fácil de leer con 1 o 20 zonas
    *
    * Por cada conteo se escriben (en este orden fijo):
    *  N filas ZONA     → una fila por zona con cantidad
    *  1 fila PERSONAL  → roles y total (siempre al final)
    *
    * Columnas: Hora | Licapa | DNI | Supervisor | Fecha | Tipo | Zona | Cantidad | roles…
    */

    var TZ = 'America/Lima';
    var HOJA = 'Hoja 1';

    var COLUMNAS = [
      'Hora Registro',
      'Licapa', 'DNI', 'Supervisor', 'Fecha',
      'Tipo', 'Zona', 'Cantidad',
      'Cosechadores', 'Escaner', 'Calidad', 'Cant Supervisor', 'Total Personal'
    ];

    // Índices de columna (0-based)
    var COL = {
      HORA: 0,
      LICAPA: 1,
      DNI: 2,
      SUPERVISOR: 3,
      FECHA: 4,
      TIPO: 5,
      ZONA: 6,
      CANTIDAD: 7,
      COSECHADORES: 8,
      ESCANER: 9,
      CALIDAD: 10,
      CANT_SUP: 11,
      TOTAL: 12
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
          var licapaDash = body.licapa || param_(e, 'licapa') || '';
          return dashboard_(fechaDash, licapaDash);
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
      var dni = limpiarDni_(d.codSupervisor || d.dni || extraerDni_(d.supervisor));
      if (!dni) {
        return { ok: false, message: 'Falta DNI del supervisor' };
      }

      if (!editar && localId && yaGuardado_(localId)) {
        return {
          ok: true,
          duplicate: true,
          message: 'Conteo ya registrado (sin duplicar)'
        };
      }

      var lock = LockService.getScriptLock();
      if (!lock.tryLock(8000)) {
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

        var nombreSup = texto_(nombreSinDni_(d.supervisor) || d.supervisorNombre || '');
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
          licapa: texto_(d.licapa) || texto_(d.grupoCosecha) || texto_(d.loteModTurno) || '',
          dni: dni,
          supervisor: nombreSup,
          fecha: fecha
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
            totalPersonal: ''
          }));
        }

        filas.push(fila_(base, 'PERSONAL', '', '', {
          cosechadores: cosechadores,
          escaner: escaner,
          calidad: calidad,
          supervisorCount: supervisorCount,
          totalPersonal: totalPersonal
        }));

        var escrito = escribirFilasNuevas_(hoja, filas);

        if (localId) marcarGuardado_(localId);
        invalidarDashboardCache_();

        return {
          ok: true,
          updated: actualizado,
          filas: filas.length,
          desde: escrito.desde,
          hasta: escrito.hasta,
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
      var fechasTxt = hoja.getRange(2, COL.FECHA + 1, lastRow, 1).getDisplayValues();
      var personal = null;
      var zonas = [];
      var batchKey = '';

      // Buscar el PERSONAL más reciente de este DNI + fecha
      for (var i = 0; i < data.length; i++) {
        var row = data[i];
        var tipo = String(row[COL.TIPO] || '').trim().toUpperCase();
        if (tipo !== 'PERSONAL') continue;
        var fechaRow = fechaCelda_(row[COL.FECHA], fechasTxt[i][0]);
        if (fechaRow !== fecha) continue;
        if (!filaEsDni_(row, dni)) continue;

        personal = row;
        batchKey = batchKey_(row, fechaRow);
        zonas = [];
      }

      if (!personal) {
        return { ok: true, existe: false, fecha: fecha, codSupervisor: dni };
      }

      // Zonas del mismo lote de registro (mismo grupo+dni+fecha+hora)
      for (var j = 0; j < data.length; j++) {
        var r = data[j];
        if (String(r[COL.TIPO] || '').trim().toUpperCase() !== 'ZONA') continue;
        if (batchKey_(r, fechaCelda_(r[COL.FECHA], fechasTxt[j][0])) !== batchKey) continue;
        var zonaNom = String(r[COL.ZONA] || '').trim().toUpperCase();
        var cant = num_(r[COL.CANTIDAD]);
        if (zonaNom && cant > 0) zonas.push({ zona: zonaNom, cantidad: cant });
      }

      var licapaVal = String(personal[COL.LICAPA] || '').trim();
      var nombreSup = String(personal[COL.SUPERVISOR] || '').trim();

      return {
        ok: true,
        existe: true,
        fecha: fecha,
        codSupervisor: dni,
        data: {
          licapa: licapaVal,
          grupoCosecha: licapaVal,
          supervisor: nombreSup,
          supervisorNombre: nombreSup,
          codSupervisor: dni,
          dni: dni,
          fecha: fecha,
          lote: '',
          modulo: '',
          turno: '',
          codLote: '',
          variedad: '',
          cosechadores: num_(personal[COL.COSECHADORES]),
          escaner: num_(personal[COL.ESCANER]),
          calidad: num_(personal[COL.CALIDAD]),
          supervisorCount: num_(personal[COL.CANT_SUP]),
          almuerzos: 0,
          permisos: 0,
          faltas: 0,
          distribucionZonas: zonas,
          horaRegistro: horaTexto_(personal[COL.HORA])
        }
      };
    }

    function batchKey_(row, fechaNorm) {
      return [
        String(row[COL.HORA] || ''),
        String(row[COL.LICAPA] || ''),
        String(row[COL.DNI] || ''),
        fechaNorm || fechaCelda_(row[COL.FECHA], '')
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
      var fechasTxt = hoja.getRange(2, COL.FECHA + 1, lastRow, 1).getDisplayValues();
      var indices = [];
      for (var i = 0; i < data.length; i++) {
        var tipo = String(data[i][COL.TIPO] || '').trim().toUpperCase();
        if (tipo !== 'ZONA' && tipo !== 'PERSONAL') continue;
        if (fechaCelda_(data[i][COL.FECHA], fechasTxt[i][0]) !== fecha) continue;
        if (!filaEsDni_(data[i], dni)) continue;
        indices.push(i + 2);
      }
      return indices;
    }

    /** Borra por bloques contiguos (mucho más rápido que deleteRow uno a uno). */
    function borrarFilas_(hoja, indices) {
      if (!indices || !indices.length) return;
      var sorted = indices.slice().sort(function (a, b) { return a - b; });
      var bloques = [];
      var ini = sorted[0];
      var fin = sorted[0];
      for (var i = 1; i < sorted.length; i++) {
        if (sorted[i] === fin + 1) {
          fin = sorted[i];
        } else {
          bloques.push([ini, fin]);
          ini = fin = sorted[i];
        }
      }
      bloques.push([ini, fin]);
      for (var b = bloques.length - 1; b >= 0; b--) {
        hoja.deleteRows(bloques[b][0], bloques[b][1] - bloques[b][0] + 1);
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

    function yaGuardado_(localId) {
      return CacheService.getScriptCache().get('lid_' + localId) !== null;
    }

    function marcarGuardado_(localId) {
      CacheService.getScriptCache().put('lid_' + localId, '1', 21600);
    }

    /**
    * Resumen desde Sheet en vivo (sin cache):
    * - Filas PERSONAL → roles
    * - Filas ZONA → personas por zona
    * fecha vacío / "hoy" = hoy Lima; "all" = todas las fechas
    */
    function dashboard_(fechaFiltro, licapaFiltro) {
      var filtroRaw = String(fechaFiltro || '').trim();
      var todas = filtroRaw.toLowerCase() === 'all' || filtroRaw === '*';
      var filtro = todas ? 'all' : resolverFechaFiltro_(filtroRaw);
      var licapaSel = normalizarLicapa_(licapaFiltro);

      var hoja = obtenerHoja_();
      asegurarEncabezados_(hoja);
      var lastRow = hoja.getLastRow();
      if (lastRow < 2) {
        return armarResultado_(todas ? 'all' : filtro, vaciosTotales_(), [], [], 0, {
          hoyServidor: hoy_(),
          fechasEncontradas: [],
          filasLeidas: 0,
          filasOmitidasPorFecha: 0,
          hoja: hoja.getName()
        });
      }

      var data = hoja.getRange(2, 1, lastRow, COLUMNAS.length).getValues();
      var fechasTxt = hoja.getRange(2, COL.FECHA + 1, lastRow, 1).getDisplayValues();
      var bySup = {};
      var byZona = {};
      var totales = vaciosTotales_();
      var conteos = 0;
      var fechasMap = {};
      var filasLeidas = 0;
      var omitidas = 0;
      var licapasMap = {};

      for (var i = 0; i < data.length; i++) {
        var row = data[i];
        var tipo = String(row[COL.TIPO] || '').trim().toUpperCase();
        if (tipo !== 'PERSONAL' && tipo !== 'ZONA') continue;

        filasLeidas++;
        var fecha = fechaCelda_(row[COL.FECHA], fechasTxt[i][0]);
        if (fecha) fechasMap[fecha] = true;

        if (!todas && fecha !== filtro) {
          omitidas++;
          continue;
        }

        var licapaFila = filaLicapa_(row);
        if (licapaFila) licapasMap[licapaFila] = true;
        if (licapaSel && licapaFila !== licapaSel) {
          omitidas++;
          continue;
        }

        if (tipo === 'PERSONAL') {
          var dniSup = limpiarDni_(row[COL.DNI]);
          var nombre = String(row[COL.SUPERVISOR] || '').trim().toUpperCase();
          if (!nombre && !dniSup) nombre = 'SIN NOMBRE';
          // Etiqueta compatible con el cliente (match por DNI o nombre)
          var label = dniSup ? (dniSup + ' · ' + (nombre || dniSup)) : nombre;
          var key = (dniSup || 'X') + '|' + nombre;

          var cos = num_(row[COL.COSECHADORES]);
          var esc = num_(row[COL.ESCANER]);
          var cal = num_(row[COL.CALIDAD]);
          var supC = num_(row[COL.CANT_SUP]);
          var tot = num_(row[COL.TOTAL]) || (cos + esc + cal + supC);
          var grupo = String(row[COL.LICAPA] || '').trim();

          if (!bySup[key]) {
            bySup[key] = {
              supervisor: label,
              cosechadores: 0,
              escaner: 0,
              calidad: 0,
              supervisorCount: 0,
              total: 0,
              conteos: 0,
              grupos: {},
              horaRegistro: '',
              zonasCant: 0
            };
          }
          var s = bySup[key];
          var horaFila = horaTexto_(row[COL.HORA]);
          if (horaFila && (!s.horaRegistro || horaFila < s.horaRegistro)) {
            s.horaRegistro = horaFila;
          }
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
          conteos += 1;
        } else {
          var zona = String(row[COL.ZONA] || '').trim().toUpperCase();
          var cant = num_(row[COL.CANTIDAD]);
          if (!zona || cant <= 0) continue;
          byZona[zona] = (byZona[zona] || 0) + cant;

          var dniZ = limpiarDni_(row[COL.DNI]);
          var nombreZ = String(row[COL.SUPERVISOR] || '').trim().toUpperCase();
          var labelZ = dniZ ? (dniZ + ' · ' + (nombreZ || dniZ)) : nombreZ;
          var keyZ = (dniZ || 'X') + '|' + nombreZ;
          if (keyZ) {
            if (!bySup[keyZ]) {
              bySup[keyZ] = {
                supervisor: labelZ,
                cosechadores: 0,
                escaner: 0,
                calidad: 0,
                supervisorCount: 0,
                total: 0,
                conteos: 0,
                grupos: {},
                horaRegistro: '',
                zonasCant: 0
              };
            }
            bySup[keyZ].zonasCant = (bySup[keyZ].zonasCant || 0) + cant;
          }
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
          grupos: nGrupos,
          horaRegistro: item.horaRegistro || '',
          zonasCant: item.zonasCant || 0,
          sinDistribucion: !(item.zonasCant > 0)
        });
      }
      // Más puntual primero (hora de registro más temprana)
      supervisores.sort(function (a, b) {
        var ha = a.horaRegistro || '99:99:99';
        var hb = b.horaRegistro || '99:99:99';
        if (ha !== hb) return ha < hb ? -1 : 1;
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

      var licapas = [];
      for (var lk in licapasMap) {
        if (licapasMap.hasOwnProperty(lk)) licapas.push(lk);
      }
      licapas.sort();

      var result = armarResultado_(todas ? 'all' : filtro, totales, supervisores, zonas, conteos, {
        hoyServidor: hoy_(),
        fechasEncontradas: fechasEncontradas,
        filasLeidas: filasLeidas,
        filasOmitidasPorFecha: omitidas,
        hoja: hoja.getName(),
        soloHoyEnBase: !todas && fechasEncontradas.length === 1 && fechasEncontradas[0] === filtro,
        licapa: licapaSel || '',
        licapas: licapas
      });

      return result;
    }

    /** LICAPA I–IV desde columna Licapa */
    function normalizarLicapa_(v) {
      var s = String(v || '').trim().toUpperCase().replace(/\s+/g, ' ');
      var m = s.match(/LICAPA\s*(IV|III|II|I|4|3|2|1)\b/);
      if (!m) return '';
      var n = m[1];
      if (n === '1') n = 'I';
      if (n === '2') n = 'II';
      if (n === '3') n = 'III';
      if (n === '4') n = 'IV';
      return 'LICAPA ' + n;
    }

    function filaLicapa_(row) {
      return normalizarLicapa_(row[COL.LICAPA]);
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
        var hoy = hoy_();
        ['dash_v8_', 'dash_v7_', 'dash_v6_', 'dash_v5_', 'dash_v4_', 'dash_v3_', 'dash_v2_'].forEach(function (p) {
          cache.remove(p + hoy);
          cache.remove(p + 'all');
        });
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
    // almuerzos/permisos/faltas quedan en 0 (compat API; ya no hay columnas)

    /** Fecha de la celda: primero lo que se ve en el Sheet, luego el valor crudo */
    function fechaCelda_(valor, display) {
      var vista = normalizarFecha_(display);
      if (/^\d{4}-\d{2}-\d{2}$/.test(vista)) return vista;
      return normalizarFecha_(valor);
    }

    /** Normaliza fechas de Sheet (Date, serial, texto) a yyyy-MM-dd calendario (sin correr un día por UTC−Lima) */
    function normalizarFecha_(v) {
      if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
        return fechaDesdeDate_(v);
      }

      if (typeof v === 'number' && isFinite(v) && v > 20000 && v < 80000) {
        // Serial de Google Sheets = días desde 1899-12-30 (calendario, no hora Lima)
        var epoch = new Date(Date.UTC(1899, 11, 30));
        var asDate = new Date(epoch.getTime() + Math.round(v) * 86400000);
        return Utilities.formatDate(asDate, 'UTC', 'yyyy-MM-dd');
      }

      var s = String(v || '').trim();
      if (!s) return '';

      var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];

      var parts = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
      if (parts) {
        var a = parseInt(parts[1], 10);
        var b = parseInt(parts[2], 10);
        var yyyy = parts[3];
        var day;
        var month;
        if (a > 12 && b <= 12) {
          day = a;
          month = b;
        } else if (b > 12 && a <= 12) {
          day = b;
          month = a;
        } else {
          day = a;
          month = b;
        }
        return yyyy + '-' + ('0' + month).slice(-2) + '-' + ('0' + day).slice(-2);
      }

      var parsed = new Date(s);
      if (!isNaN(parsed.getTime())) {
        return fechaDesdeDate_(parsed);
      }

      return s;
    }

    /** Date de Sheets: medianoche UTC = día del calendario; si no, día en Lima */
    function fechaDesdeDate_(d) {
      if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
        return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
      }
      return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
    }

    function fila_(base, tipo, zona, cantidad, extra) {
      extra = extra || {};
      return [
        base.horaRegistro,
        base.licapa,
        base.dni,
        base.supervisor,
        base.fecha,
        tipo,
        zona,
        cantidad === '' ? '' : num_(cantidad),
        extra.cosechadores === '' ? '' : num_(extra.cosechadores),
        extra.escaner === '' ? '' : num_(extra.escaner),
        extra.calidad === '' ? '' : num_(extra.calidad),
        extra.supervisorCount === '' ? '' : num_(extra.supervisorCount),
        extra.totalPersonal === '' ? '' : num_(extra.totalPersonal)
      ];
    }

    /**
     * Escribe filas nuevas al final. Evita el error
     * "datos tienen N y el rango M" (setValues desfasado).
     */
    function escribirFilasNuevas_(hoja, filas) {
      var n = filas.length;
      var cols = COLUMNAS.length;
      if (n < 1) return { desde: 0, hasta: 0 };

      var mat = [];
      for (var i = 0; i < n; i++) {
        var row = (filas[i] || []).slice(0, cols);
        while (row.length < cols) row.push('');
        mat.push(row);
      }

      var start = Math.max(hoja.getLastRow() + 1, 2);
      try {
        hoja.getRange(start, 1, start + n - 1, cols).setValues(mat);
      } catch (errSet) {
        // Fallback seguro fila a fila
        for (var k = 0; k < mat.length; k++) {
          hoja.appendRow(mat[k]);
        }
        start = hoja.getLastRow() - n + 1;
      }
      return { desde: start, hasta: start + n - 1 };
    }

    function headerEq_(a, b) {
      return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
    }

    /** Formato actual slim: Licapa | DNI | … | Tipo en col F */
    function encabezadosEstructuraOk_(headers) {
      if (!headers || headers.length < 6) return false;
      var dniOk = headerEq_(headers[COL.DNI], 'DNI') ||
        headerEq_(headers[COL.DNI], 'COD SUPERVISOR') ||
        headerEq_(headers[COL.DNI], 'CODIGO');
      var tipoOk = headerEq_(headers[COL.TIPO], 'Tipo') ||
        headerEq_(headers[COL.TIPO], 'TIPO FILA') ||
        headerEq_(headers[COL.TIPO], 'TIPO REGISTRO');
      var licapaOk = headerEq_(headers[COL.LICAPA], 'Licapa') ||
        headerEq_(headers[COL.LICAPA], 'Grupo Cosecha') ||
        headerEq_(headers[COL.LICAPA], 'LICAPA');
      return dniOk && tipoOk && licapaOk;
    }

    /** Formato ancho anterior (19 cols): Tipo en col I, Cod Lote / Almuerzos, etc. */
    function esFormatoAnchoViejo_(headers) {
      if (!headers || headers.length < 15) return false;
      if (headerEq_(headers[8], 'Tipo') && (
        headerEq_(headers[1], 'Grupo Cosecha') ||
        headerEq_(headers[5], 'Lote Mod Turno') ||
        headerEq_(headers[5], 'Licapa') ||
        headerEq_(headers[6], 'Cod Lote') ||
        headerEq_(headers[16], 'Almuerzos')
      )) return true;
      return false;
    }

    function encabezadosIguales_(headers) {
      if (!headers || headers.length < COLUMNAS.length) return false;
      for (var i = 0; i < COLUMNAS.length; i++) {
        if (!headerEq_(headers[i], COLUMNAS[i])) return false;
      }
      return true;
    }

    function escribirEncabezados_(hoja) {
      hoja.getRange(1, 1, 1, COLUMNAS.length).setValues([COLUMNAS]);
      estilizarEncabezados_(hoja, COLUMNAS.length);
    }

    /**
     * Asegura fila 1 = COLUMNAS.
     * Migra formato ancho viejo → slim. Nunca inserta filas de encabezado extra.
     */
    function asegurarEncabezados_(hoja) {
      // Cache: no re-leer / migrar en cada Guardar (era lento)
      try {
        if (CacheService.getScriptCache().get('hdr_slim_v4') === '1') return;
      } catch (eCache) { /* ok */ }

      var lastRow = hoja.getLastRow();
      var lastCol = Math.max(hoja.getLastColumn(), 1);

      if (lastRow === 0) {
        escribirEncabezados_(hoja);
        try { CacheService.getScriptCache().put('hdr_slim_v4', '1', 21600); } catch (e1) { /* ok */ }
        return;
      }

      var raw = hoja.getRange(1, 1, 1, Math.max(lastCol, 19)).getValues()[0];
      var headers = [];
      for (var i = 0; i < raw.length; i++) {
        headers.push(String(raw[i] || '').trim());
      }

      if (encabezadosIguales_(headers)) {
        try { CacheService.getScriptCache().put('hdr_slim_v4', '1', 21600); } catch (e2) { /* ok */ }
        return;
      }

      // Sin col DNI (Supervisor en C, Tipo en H)
      if (headerEq_(headers[2], 'Supervisor') && headerEq_(headers[7], 'Tipo')) {
        migrarSepararDni_(hoja);
        migrarAFormatoSlim_(hoja);
        return;
      }

      if (esFormatoAnchoViejo_(headers)) {
        migrarAFormatoSlim_(hoja);
        return;
      }

      if (encabezadosEstructuraOk_(headers)) {
        escribirEncabezados_(hoja);
        try { CacheService.getScriptCache().put('hdr_slim_v4', '1', 21600); } catch (e3) { /* ok */ }
        return;
      }

      if (lastRow > 1) {
        escribirEncabezados_(hoja);
        try { CacheService.getScriptCache().put('hdr_slim_v4', '1', 21600); } catch (e4) { /* ok */ }
        return;
      }

      hoja.clear();
      escribirEncabezados_(hoja);
      try { CacheService.getScriptCache().put('hdr_slim_v4', '1', 21600); } catch (e5) { /* ok */ }
    }

    /** Inserta col DNI y parte "75075892 · NOMBRE" (formato pre-DNI). */
    function migrarSepararDni_(hoja) {
      hoja.insertColumnAfter(2);
      var lastRow = hoja.getLastRow();
      if (lastRow < 2) {
        invalidarDashboardCache_();
        return;
      }
      var range = hoja.getRange(2, 3, lastRow, 4);
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

    /**
     * Convierte hoja ancha (Grupo Cosecha + Lote Mod + Cod Lote + Variedad + Almuerzos…)
     * al formato slim con columna Licapa.
     * Índices viejos: 0 Hora, 1 Grupo, 2 DNI, 3 Sup, 4 Fecha, 5 LoteMod/Licapa,
     * 6 CodLote, 7 Variedad, 8 Tipo, 9 Zona, 10 Cant, 11–15 roles, 16–18 alm/perm/fal
     */
    function migrarAFormatoSlim_(hoja) {
      var lastRow = hoja.getLastRow();
      var lastCol = Math.max(hoja.getLastColumn(), 19);
      if (lastRow < 2) {
        hoja.clear();
        escribirEncabezados_(hoja);
        invalidarDashboardCache_();
        return;
      }

      var data = hoja.getRange(2, 1, lastRow, lastCol).getValues();
      var out = [];
      for (var i = 0; i < data.length; i++) {
        var r = data[i];
        var tipo = String(r[8] || '').trim().toUpperCase();
        if (tipo !== 'ZONA' && tipo !== 'PERSONAL') continue;
        var licapa = normalizarLicapa_(r[1]) || normalizarLicapa_(r[5]) ||
          String(r[1] || r[5] || '').trim().toUpperCase();
        out.push([
          r[0],
          licapa,
          r[2],
          r[3],
          r[4],
          r[8],
          r[9],
          r[10],
          r[11],
          r[12],
          r[13],
          r[14],
          r[15]
        ]);
      }

      hoja.clear();
      escribirEncabezados_(hoja);
      if (out.length) {
        escribirFilasNuevas_(hoja, out);
      }
      // Quitar columnas sobrantes a la derecha
      var maxCol = hoja.getMaxColumns();
      if (maxCol > COLUMNAS.length) {
        hoja.deleteColumns(COLUMNAS.length + 1, maxCol - COLUMNAS.length);
      }
      try { CacheService.getScriptCache().remove('hdr_slim_v4'); } catch (eMig) { /* ok */ }
      invalidarDashboardCache_();
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

    /** Normaliza celda de hora (Date, fracción Excel o texto) a HH:mm:ss */
    function horaTexto_(val) {
      if (val == null || val === '') return '';

      // Fracción de día de Sheets/Excel (ej. 0.25 = 06:00)
      if (typeof val === 'number' && isFinite(val) && val >= 0 && val < 2) {
        var frac = val % 1;
        if (frac < 0) frac += 1;
        var totalSec = Math.round(frac * 86400);
        if (totalSec >= 86400) totalSec = 86399;
        var hhN = Math.floor(totalSec / 3600);
        var mmN = Math.floor((totalSec % 3600) / 60);
        var ssN = totalSec % 60;
        return ('0' + hhN).slice(-2) + ':' + ('0' + mmN).slice(-2) + ':' + ('0' + ssN).slice(-2);
      }

      if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
        return Utilities.formatDate(val, TZ, 'HH:mm:ss');
      }

      var t = String(val).trim();
      if (!t) return '';

      var m = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (m) {
        var hh = ('0' + parseInt(m[1], 10)).slice(-2);
        var mm = m[2];
        var ss = m[3] || '00';
        return hh + ':' + mm + ':' + ss;
      }
      return '';
    }

    function responder_(obj) {
      return ContentService
        .createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
    }

    /** Menú en el Sheet */
    function onOpen() {
      SpreadsheetApp.getUi()
        .createMenu('Q Berries')
        .addItem('Actualizar 4 gráficos limpios', 'actualizarDashboardGraficos')
        .addItem('Borrar gráficos amontonados', 'borrarTodosLosGraficos')
        .addToUi();
    }

    /** Quita todos los gráficos del libro (LIC amontonados, etc.) */
    function borrarTodosLosGraficos() {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var hojas = ss.getSheets();
      var n = 0;
      for (var i = 0; i < hojas.length; i++) {
        var charts = hojas[i].getCharts();
        for (var c = 0; c < charts.length; c++) {
          hojas[i].removeChart(charts[c]);
          n++;
        }
      }
      try {
        SpreadsheetApp.getUi().alert(
          'Listo',
          'Se borraron ' + n + ' gráficos.\nLuego: Actualizar 4 gráficos limpios.',
          SpreadsheetApp.getUi().ButtonSet.OK
        );
      } catch (e) { /* ok */ }
    }

    /**
    * 4 gráficos pequeños: Roles · Top 3 · Zonas · Resumen
    * Sin listar a todos (eso amontona números).
    */
    function actualizarDashboardGraficos() {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var hojas = ss.getSheets();
      for (var h = 0; h < hojas.length; h++) {
        var old = hojas[h].getCharts();
        for (var o = 0; o < old.length; o++) hojas[h].removeChart(old[o]);
      }

      var dash = ss.getSheetByName('Dashboard');
      if (!dash) dash = ss.insertSheet('Dashboard');
      dash.clear();

      var data = dashboard_('hoy');
      var t = data.totales || {};
      var supers = (data.supervisores || []).slice(0, 3);
      var zonas = (data.zonas || []).slice(0, 3);
      var fechaTxt = String(data.fecha || hoy_());

      dash.getRange('A1').setValue('Q Berries · ' + fechaTxt + ' · 4 gráficos');
      dash.getRange('A1').setFontWeight('bold').setFontSize(13).setFontColor('#D61F26');
      dash.getRange('A2').setValue('Compacto: Top 3 · un número por barra');
      dash.getRange('A2').setFontSize(9).setFontColor('#6B7280');

      dash.getRange('A4:B4').setValues([['Rol', 'N']]).setFontWeight('bold');
      dash.getRange('A5:B8').setValues([
        ['Cosech.', t.cosechadores || 0],
        ['Escáner', t.escaner || 0],
        ['Calidad', t.calidad || 0],
        ['Sup', t.supervisorCount || 0]
      ]);

      dash.getRange('D4:E4').setValues([['Top', 'Cos.']]).setFontWeight('bold');
      var supRows = [];
      for (var i = 0; i < supers.length; i++) {
        var nom = nombreCortoGrafico_(supers[i].supervisor);
        supRows.push(['#' + (i + 1) + ' ' + nom, supers[i].cosechadores || 0]);
      }
      if (!supRows.length) supRows.push(['—', 0]);
      dash.getRange(5, 4, 4 + supRows.length, 5).setValues(supRows);

      dash.getRange('G4:H4').setValues([['Zona', 'Pers.']]).setFontWeight('bold');
      var zonaRows = [];
      for (var z = 0; z < zonas.length; z++) {
        var zn = String(zonas[z].zona || '');
        if (zn.length > 12) zn = zn.substring(0, 11) + '…';
        zonaRows.push([zn, zonas[z].cantidad || 0]);
      }
      if (!zonaRows.length) zonaRows.push(['—', 0]);
      dash.getRange(5, 7, 4 + zonaRows.length, 8).setValues(zonaRows);

      dash.getRange('J4:K4').setValues([['KPI', 'Valor']]).setFontWeight('bold');
      dash.getRange('J5:K7').setValues([
        ['Personal', t.total || 0],
        ['Conteos', t.conteos || 0],
        ['Sup.', t.supervisoresUnicos || 0]
      ]);

      var nSup = Math.max(supRows.length, 1);
      var nZona = Math.max(zonaRows.length, 1);

      dash.insertChart(
        dash.newChart()
          .setChartType(Charts.ChartType.PIE)
          .addRange(dash.getRange(4, 1, 8, 2))
          .setPosition(10, 1, 0, 0)
          .setOption('title', 'Roles')
          .setOption('pieSliceText', 'none')
          .setOption('legend', { position: 'labeled', textStyle: { fontSize: 10 } })
          .setOption('chartArea', { left: 10, top: 36, width: '90%', height: '78%' })
          .setOption('width', 340)
          .setOption('height', 220)
          .setOption('colors', ['#1f6b45', '#3B82F6', '#F7941E', '#D61F26'])
          .build()
      );

      dash.insertChart(
        dash.newChart()
          .setChartType(Charts.ChartType.BAR)
          .addRange(dash.getRange(4, 4, 4 + nSup, 5))
          .setPosition(10, 6, 0, 0)
          .setOption('title', 'Top 3 supervisores')
          .setOption('legend', { position: 'none' })
          .setOption('chartArea', { left: 100, top: 36, right: 24, bottom: 36, width: '60%', height: '70%' })
          .setOption('hAxis', { minValue: 0, gridlines: { count: 4 }, textStyle: { fontSize: 9 }, format: '0' })
          .setOption('vAxis', { textStyle: { fontSize: 9 } })
          .setOption('series', { 0: { dataLabel: 'none' } })
          .setOption('colors', ['#1f6b45'])
          .setOption('width', 340)
          .setOption('height', 220)
          .build()
      );

      dash.insertChart(
        dash.newChart()
          .setChartType(Charts.ChartType.COLUMN)
          .addRange(dash.getRange(4, 7, 4 + nZona, 8))
          .setPosition(24, 1, 0, 0)
          .setOption('title', 'Top 3 zonas')
          .setOption('legend', { position: 'none' })
          .setOption('chartArea', { left: 36, top: 36, right: 16, bottom: 48, width: '78%', height: '62%' })
          .setOption('hAxis', { textStyle: { fontSize: 9 } })
          .setOption('vAxis', { minValue: 0, gridlines: { count: 4 }, textStyle: { fontSize: 9 }, format: '0' })
          .setOption('series', { 0: { dataLabel: 'none' } })
          .setOption('colors', ['#F7941E'])
          .setOption('width', 340)
          .setOption('height', 220)
          .build()
      );

      dash.insertChart(
        dash.newChart()
          .setChartType(Charts.ChartType.COLUMN)
          .addRange(dash.getRange(4, 10, 7, 11))
          .setPosition(24, 6, 0, 0)
          .setOption('title', 'Resumen del día')
          .setOption('legend', { position: 'none' })
          .setOption('chartArea', { left: 36, top: 36, right: 16, bottom: 40, width: '78%', height: '65%' })
          .setOption('hAxis', { textStyle: { fontSize: 10 } })
          .setOption('vAxis', { minValue: 0, gridlines: { count: 4 }, textStyle: { fontSize: 9 }, format: '0' })
          .setOption('series', { 0: { dataLabel: 'none' } })
          .setOption('colors', ['#D61F26'])
          .setOption('width', 340)
          .setOption('height', 220)
          .build()
      );

      dash.getRange('A28').setValue('Personal');
      dash.getRange('B28').setValue(t.total || 0).setFontSize(22).setFontWeight('bold').setFontColor('#D61F26');
      dash.getRange('C28').setValue('Conteos');
      dash.getRange('D28').setValue(t.conteos || 0).setFontSize(22).setFontWeight('bold').setFontColor('#1f6b45');
      dash.getRange('E28').setValue('Sup.');
      dash.getRange('F28').setValue(t.supervisoresUnicos || 0).setFontSize(22).setFontWeight('bold').setFontColor('#3B82F6');

      dash.activate();
      try {
        SpreadsheetApp.getUi().alert(
          'Listo',
          '4 gráficos pequeños: Roles · Top 3 · Zonas · Resumen',
          SpreadsheetApp.getUi().ButtonSet.OK
        );
      } catch (eUi) { /* ok */ }
    }

    function nombreCortoGrafico_(raw) {
      var s = String(raw || '')
        .replace(/^\d{8,9}\s*[·\-–]?\s*/, '')
        .trim()
        .toUpperCase();
      if (!s) return '—';
      var partes = s.split(/\s+/);
      if (partes.length >= 2) return partes[0] + ' ' + partes[1];
      return s.length > 14 ? s.substring(0, 12) + '…' : s;
    }
