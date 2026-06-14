import { obtenerDetallePartido, obtenerPartidosFotmobPorFecha } from '../src/data/pipeline/fotmob.js';

const SEP  = '─'.repeat(62);
const SEP2 = '═'.repeat(62);

// ═══════════════════════════════════════════════════════════════
// PASO 1 — Inspección del JSON completo de matchDetails 4667751
//           (México vs Sudáfrica — ya lo habíamos descargado)
// ═══════════════════════════════════════════════════════════════
console.log(`\n${SEP2}`);
console.log('PASO 1 — matchDetails?matchId=4667751 (México vs Sudáfrica)');
console.log(`${SEP2}\n`);

const det = await obtenerDetallePartido(4667751);

// ── Nivel superior ──────────────────────────────────────────────
console.log('Keys de nivel superior:');
console.log(' ', Object.keys(det));

// ── Explorar cada key que NO sea "content" (lo que ya vimos) ───
const PALABRAS_CLAVE = ['form', 'history', 'previous', 'h2h', 'head', 'recent',
                        'match', 'result', 'squad', 'player', 'home', 'away',
                        'team', 'fixture', 'lineup', 'squad', 'stats'];

function contieneHistorial(key) {
  return PALABRAS_CLAVE.some(p => key.toLowerCase().includes(p));
}

function inspeccionarObjeto(obj, prefijo = '', maxProfundidad = 3) {
  if (maxProfundidad === 0 || obj === null || typeof obj !== 'object') return;
  const entries = Array.isArray(obj)
    ? obj.slice(0, 2).map((v, i) => [`[${i}]`, v])
    : Object.entries(obj);

  for (const [k, v] of entries) {
    const ruta = prefijo ? `${prefijo}.${k}` : k;
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') {
      const resumen = Array.isArray(v)
        ? `array[${v.length}]`
        : `{ ${Object.keys(v).join(', ')} }`;
      console.log(`  ${ruta}: ${resumen}`);
      // Profundizar solo en keys que parecen relevantes
      if (contieneHistorial(k) || ['general', 'header', 'content'].includes(k.toLowerCase())) {
        inspeccionarObjeto(v, ruta, maxProfundidad - 1);
      }
    } else {
      const val = String(v).slice(0, 80);
      // Mostrar solo si podría ser una fecha anterior al Mundial o algo interesante
      if (typeof v === 'string' && (v.includes('202') || v.includes('201') || v.length < 20)) {
        console.log(`  ${ruta}: ${val}`);
      }
    }
  }
}

console.log('\n── Exploración completa ──');
for (const [k, v] of Object.entries(det)) {
  if (v === null || v === undefined) {
    console.log(`\n${k}: null`);
    continue;
  }
  if (typeof v !== 'object') {
    console.log(`\n${k}: ${String(v).slice(0, 80)}`);
    continue;
  }
  const resumen = Array.isArray(v)
    ? `array[${v.length}]`
    : `{ ${Object.keys(v).join(', ')} }`;
  console.log(`\n${k}: ${resumen}`);
  inspeccionarObjeto(v, k, 2);
}

// ── Búsqueda explícita de fechas pre-Mundial ─────────────────────
console.log(`\n${SEP}`);
console.log('Búsqueda de fechas anteriores a 2026-06-11 en todo el JSON:');
const rawText = JSON.stringify(det);
const fechasMatch = rawText.match(/202[0-5]-\d{2}-\d{2}|2026-0[1-5]-\d{2}|2026-06-0[0-9]/g);
if (fechasMatch?.length) {
  console.log('  Fechas encontradas:', [...new Set(fechasMatch)]);
} else {
  console.log('  ⚠ Ninguna fecha pre-Mundial encontrada en este JSON.');
}

// ── Buscar keys que sugieran historial ────────────────────────────
const todasLasKeys = new Set();
function extraerKeys(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(Array.isArray(obj) ? {} : obj)) {
    todasLasKeys.add(k);
    extraerKeys(v);
  }
  if (Array.isArray(obj)) obj.forEach(extraerKeys);
}
extraerKeys(det);

const keysHistorial = [...todasLasKeys].filter(k =>
  PALABRAS_CLAVE.some(p => k.toLowerCase().includes(p))
).sort();

console.log('\nTodas las keys del JSON que contienen palabras clave de historial:');
console.log(' ', keysHistorial.length ? keysHistorial : '(ninguna)');

// ═══════════════════════════════════════════════════════════════
// PASO 2 — Endpoints alternativos de FotMob para México (id=6710)
// ═══════════════════════════════════════════════════════════════
console.log(`\n${SEP2}`);
console.log('PASO 2 — Endpoints alternativos de equipo en FotMob (id=6710)');
console.log(`${SEP2}\n`);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':     'application/json,text/plain,*/*',
  'Referer':    'https://www.fotmob.com/'
};

const ENDPOINTS = [
  '/api/data/teams?id=6710',
  '/api/data/team?id=6710',
  '/api/data/teamOverview?id=6710',
];

for (const path of ENDPOINTS) {
  const url = `https://www.fotmob.com${path}`;
  process.stdout.write(`GET ${path} ... `);
  try {
    const res  = await fetch(url, { headers: HEADERS });
    const text = await res.text();
    process.stdout.write(`HTTP ${res.status}\n`);

    if (res.status === 200) {
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        console.log('  → respuesta no es JSON (posible Cloudflare)\n');
        continue;
      }
      const keys = Array.isArray(data) ? `array[${data.length}]` : Object.keys(data);
      console.log(`  → Keys de nivel superior: ${JSON.stringify(keys)}`);

      // Si hay algo que suene a historial, profundizar
      const histKeys = Array.isArray(data) ? [] : Object.keys(data).filter(k =>
        PALABRAS_CLAVE.some(p => k.toLowerCase().includes(p))
      );
      if (histKeys.length) {
        for (const k of histKeys) {
          const v = data[k];
          const resumen = Array.isArray(v)
            ? `array[${v.length}] — primer elemento: ${JSON.stringify(v[0]).slice(0, 120)}`
            : `{ ${Object.keys(v ?? {}).join(', ')} }`;
          console.log(`  → "${k}": ${resumen}`);
        }
      }
      console.log();
    }
  } catch (err) {
    console.log(`Error de red: ${err.message}\n`);
  }
}
