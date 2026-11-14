// Rutas /api/*, escritas con Request/Response estándar para que las use tanto el
// servidor Node como el Worker de Cloudflare. Devuelve null si la ruta no es de la API.
import { createCore } from './core.js';

export function createApi({ config, crm, store }) {
  const core = createCore({ config, crm, store });

  const json = (status, data) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });

  const pinRejected = (state) =>
    state === 'locked'
      ? json(429, { result: 'error', message: 'Demasiados intentos de PIN. Espera 10 minutos.' })
      : json(401, { result: 'error', message: 'PIN incorrecto.' });

  function explain(e) {
    if (e.status === 401) return 'Kommo rechazó el token. Revisa KOMMO_TOKEN.';
    if (e.name === 'TimeoutError') return 'Kommo no respondió a tiempo. Intenta de nuevo.';
    return 'No se pudo validar con Kommo. Intenta de nuevo.';
  }

  return async function handle(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return null;

    const pin = await core.pinCheck(request.headers.get('x-pin'));
    const since = Number(url.searchParams.get('since')) || 0;

    if (url.pathname === '/api/status' && request.method === 'GET') {
      return json(200, {
        mode: crm.mode,
        pipeline: config.pipelineName,
        pinRequired: !!config.pin,
        pinValid: pin === 'ok',
      });
    }

    if (pin !== 'ok') return pinRejected(pin);

    if (url.pathname === '/api/checkin' && request.method === 'POST') {
      let code;
      try {
        code = (await request.json())?.code;
      } catch {
        return json(400, { result: 'error', message: 'Solicitud no válida.' });
      }
      try {
        const out = await core.checkin(code);
        console.log(`[checkin] "${String(code).slice(0, 60)}" -> ${out.result}${out.person ? ' (lead ' + out.person.leadId + ')' : ''}`);
        return json(200, out);
      } catch (e) {
        console.error('[checkin]', e.message, e.body ?? '');
        return json(502, { result: 'error', message: explain(e) });
      }
    }

    if (url.pathname === '/api/scans' && request.method === 'GET') {
      return json(200, { scans: await core.listScans(since) });
    }

    if (url.pathname === '/api/entries' && request.method === 'GET') {
      return json(200, { entries: await core.listEntries(since) });
    }

    if (url.pathname === '/api/entries.csv' && request.method === 'GET') {
      return new Response(await core.entriesCsv(since), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="entradas-lista-52.csv"',
          'Cache-Control': 'no-store',
        },
      });
    }

    return json(404, { message: 'No encontrado' });
  };
}
