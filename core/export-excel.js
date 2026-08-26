import { formatFechaLima, todayStr } from './utils.js';
import {
  extraerDni,
  nombreVisible,
  supervisoresFaltantes,
  validarSupervisores,
  matchSupervisorFijo
} from './supervisores-catalog.js';

function xmlEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function infoSup(raw) {
  const matched = matchSupervisorFijo(raw);
  const dni = extraerDni(raw) || matched?.dni || '';
  const nombre = nombreVisible(raw) || matched?.nombre || String(raw || '');
  return { dni, nombre };
}

function metaRango(data, modo) {
  const fechaLabel = data.fecha === 'all'
    ? 'Todas las fechas'
    : (formatFechaLima(data.fecha) || data.fecha || todayStr());
  const rango = modo === 'all' || data.fecha === 'all' ? 'Todo' : 'Hoy';
  const stamp = String(data.fecha || todayStr()).replace(/[^\d-]/g, '') || todayStr();
  return { fechaLabel, rango, stamp };
}

function colLetter(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** @param {(string|number|null|undefined)[][]} rows */
function sheetXml(rows) {
  const maxCols = Math.max(1, ...rows.map((r) => r.length));
  const maxRow = Math.max(1, rows.length);
  const ref = `A1:${colLetter(maxCols)}${maxRow}`;
  const rowXml = rows.map((cells, ri) => {
    const cXml = cells.map((val, ci) => {
      const refCell = `${colLetter(ci + 1)}${ri + 1}`;
      if (typeof val === 'number' && Number.isFinite(val)) {
        return `<c r="${refCell}"><v>${val}</v></c>`;
      }
      const t = xmlEsc(val == null ? '' : String(val));
      return `<c r="${refCell}" t="inlineStr"><is><t>${t}</t></is></c>`;
    }).join('');
    return `<row r="${ri + 1}">${cXml}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${ref}"/>
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
}

function tableRoles(data) {
  const t = data.totales || {};
  const total = (t.cosechadores || 0) + (t.escaner || 0) + (t.calidad || 0) + (t.supervisorCount || 0);
  return [
    ['Rol', 'Cantidad'],
    ['Cosechadores', t.cosechadores || 0],
    ['Escáner', t.escaner || 0],
    ['Calidad', t.calidad || 0],
    ['Supervisor', t.supervisorCount || 0],
    ['Total', t.total || total]
  ];
}

/** Misma data que el modal "Ranking de supervisores" */
function tableSupervisores(data, modo = 'hoy') {
  const t = data.totales || {};
  const supervisores = Array.isArray(data.supervisores) ? data.supervisores : [];
  const { fechaLabel, rango } = metaRango(data, modo);

  const rows = [
    ['Ranking por puntualidad', '', '', '', '', '', '', '', '', '', ''],
    ['Rango', rango, '', '', '', '', '', '', '', '', ''],
    ['Fecha', fechaLabel, '', '', '', '', '', '', '', '', ''],
    ['Supervisores', t.supervisoresUnicos || 0, '', '', '', '', '', '', '', '', ''],
    ['Cosechadores', t.cosechadores || 0, '', '', '', '', '', '', '', '', ''],
    ['Conteos', t.conteos || 0, '', '', '', '', '', '', '', '', ''],
    [],
    [
      '#',
      'Hora',
      'DNI',
      'Supervisor',
      'Conteos',
      'Grupos',
      'Cosechadores',
      'Escáner',
      'Calidad',
      'Sup',
      'Total'
    ]
  ];

  const ordenados = [...supervisores].sort((a, b) => {
    const ha = a.horaRegistro || '99:99:99';
    const hb = b.horaRegistro || '99:99:99';
    if (ha !== hb) return ha < hb ? -1 : 1;
    return (b.cosechadores || 0) - (a.cosechadores || 0) || (b.total || 0) - (a.total || 0);
  });

  ordenados.forEach((s, i) => {
    const info = infoSup(s.supervisor);
    const hora = (s.horaRegistro || '').replace(/^(\d{2}:\d{2}).*/, '$1');
    rows.push([
      i + 1,
      hora,
      info.dni,
      info.nombre,
      s.conteos || 0,
      s.grupos || 0,
      s.cosechadores || 0,
      s.escaner || 0,
      s.calidad || 0,
      s.supervisorCount || 0,
      s.total || 0
    ]);
  });

  return rows;
}

function tableZonas(data) {
  const zonas = Array.isArray(data.zonas) ? data.zonas : [];
  const rows = [['#', 'Zona', 'Cantidad']];
  zonas.forEach((z, i) => {
    rows.push([i + 1, z.zona || '', z.cantidad || 0]);
  });
  return rows;
}

function tableFaltan(data) {
  const { presentes, faltan, total } = validarSupervisores(data.supervisores || []);
  const rows = [
    ['Validar supervisores', '', '', ''],
    ['Lista fija', total, '', ''],
    ['Reportaron', presentes.length, '', ''],
    ['Faltan', faltan.length, '', ''],
    [],
    ['Estado', 'DNI', 'Supervisor', 'Fundo']
  ];
  faltan.forEach((s) => {
    rows.push(['Falta', s.dni, s.nombre, s.fundo || 'LICAPA']);
  });
  presentes.forEach((s) => {
    rows.push(['Reportó', s.dni, s.nombre, s.fundo || 'LICAPA']);
  });
  return rows;
}

function tableResumen(data, modo) {
  const { fechaLabel, rango } = metaRango(data, modo);
  const t = data.totales || {};
  const faltan = supervisoresFaltantes(data.supervisores || []);
  return [
    ['Campo', 'Valor'],
    ['Rango', rango],
    ['Fecha', fechaLabel],
    ['Supervisores reportaron', t.supervisoresUnicos || 0],
    ['Conteos', t.conteos || 0],
    ['Cosechadores', t.cosechadores || 0],
    ['Escáner', t.escaner || 0],
    ['Calidad', t.calidad || 0],
    ['Rol supervisor', t.supervisorCount || 0],
    ['Total personal', t.total || 0],
    ['Faltan reportar', faltan.length]
  ];
}

/**
 * Excel por sección de tarjeta: roles | supervisores | zonas
 */
export function descargarExcelSeccion(data, seccion, { modo = 'hoy' } = {}) {
  if (!data?.ok && !data?.totales) {
    throw new Error('Sin datos para exportar');
  }

  const { rango, stamp } = metaRango(data, modo);
  let name = 'datos';
  let sheetName = 'Datos';
  let rows = [];

  if (seccion === 'roles') {
    name = 'roles';
    sheetName = 'Roles';
    rows = tableRoles(data);
  } else if (seccion === 'supervisores' || seccion === 'cosechadores') {
    name = 'supervisores';
    sheetName = 'Ranking';
    rows = tableSupervisores(data, modo);
  } else if (seccion === 'zonas') {
    name = 'zonas';
    sheetName = 'Zonas';
    rows = tableZonas(data);
  } else if (seccion === 'faltan') {
    name = 'faltan';
    sheetName = 'Faltan';
    rows = tableFaltan(data);
  } else {
    throw new Error('Sección no válida');
  }

  const filename = `conteo-${name}-${rango.toLowerCase()}-${stamp}.xlsx`;
  descargarXlsx([{ name: sheetName, rows }], filename);
  return filename;
}

/** Excel completo (todas las hojas) */
export function descargarExcelDashboard(data, { modo = 'hoy' } = {}) {
  if (!data?.ok && !data?.totales) {
    throw new Error('Sin datos para exportar');
  }

  const { rango, stamp } = metaRango(data, modo);
  const filename = `conteo-qberries-${rango.toLowerCase()}-${stamp}.xlsx`;
  descargarXlsx([
    { name: 'Resumen', rows: tableResumen(data, modo) },
    { name: 'Roles', rows: tableRoles(data) },
    { name: 'Ranking', rows: tableSupervisores(data, modo) },
    { name: 'Zonas', rows: tableZonas(data) },
    { name: 'Faltan', rows: tableFaltan(data) }
  ], filename);
  return filename;
}

/** @param {{ name: string, rows: (string|number)[][] }[]} sheets */
function descargarXlsx(sheets, filename) {
  const files = buildXlsxFiles(sheets);
  const blob = zipStore(files);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function buildXlsxFiles(sheets) {
  const safeSheets = sheets.map((s, i) => ({
    name: String(s.name || `Hoja${i + 1}`).slice(0, 31),
    rows: s.rows || [['']]
  }));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${safeSheets.map((_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('')}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${safeSheets.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join('')}
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${safeSheets.map((s, i) =>
      `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    ).join('')}
  </sheets>
</workbook>`;

  /** @type {{ name: string, data: Uint8Array }[]} */
  const files = [
    { name: '[Content_Types].xml', data: utf8(contentTypes) },
    { name: '_rels/.rels', data: utf8(rootRels) },
    { name: 'xl/workbook.xml', data: utf8(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: utf8(wbRels) }
  ];

  safeSheets.forEach((s, i) => {
    files.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: utf8(sheetXml(s.rows))
    });
  });

  return files;
}

function utf8(str) {
  return new TextEncoder().encode(str);
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (~c) >>> 0;
}

function u16(n) {
  return new Uint8Array([n & 255, (n >>> 8) & 255]);
}

function u32(n) {
  return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
}

function concat(parts) {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** ZIP sin compresión (store) — Excel lo abre como .xlsx real */
function zipStore(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = utf8(file.name);
    const data = file.data;
    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data
    ]);
    localParts.push(local);

    const central = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes
    ]);
    centralParts.push(central);
    offset += local.length;
  }

  const centralDir = concat(centralParts);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0)
  ]);

  const zipBytes = concat([...localParts, centralDir, end]);
  return new Blob([zipBytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}
