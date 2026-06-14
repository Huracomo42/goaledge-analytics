import { obtenerPartidosFotmobPorFecha } from '../src/data/pipeline/fotmob.js';

// Fecha con partido conocido: Mexico vs South Africa (FINISHED según football-data.org)
const FECHA = '20260611';

console.log(`\nConsultando FotMob — fecha ${FECHA} (Mexico vs South Africa)...\n`);

try {
  const datos = await obtenerPartidosFotmobPorFecha(FECHA);

  console.log('Status HTTP: 200');
  console.log('Respuesta JSON válida.\n');
  console.log('--- Primeras 500 caracteres del JSON ---');
  console.log(JSON.stringify(datos).slice(0, 500));

} catch (err) {
  const status = err.status ?? 'error de red';
  console.log(`Status HTTP: ${status}`);

  if (err.name === 'TypeError') {
    // fetch() lanza TypeError en fallos de red (DNS, timeout, sin conexión)
    console.log(`Error de red — no se pudo conectar: ${err.message}`);

  } else if (err.body !== undefined) {
    // 200 pero no JSON → Cloudflare u otro proxy devolvió HTML
    console.log('POSIBLE BLOQUEO DE CLOUDFLARE — la respuesta no es JSON válido.');
    console.log('\n--- Primeras 500 caracteres de la respuesta recibida ---');
    console.log(err.body.slice(0, 500));

  } else {
    console.log(`Error: ${err.message}`);
  }
}
