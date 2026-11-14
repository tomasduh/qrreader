// Lógica de la taquilla, sin depender de dónde corre (Node o Cloudflare).
//
// Recibe tres piezas:
//   config: ajustes (ver config.js)
//   crm:    acceso a los leads (kommo.js)
//   store:  base de datos local con las entradas y los intentos de PIN
//           (store-sqlite.js en Node, store-d1.js en Cloudflare)
//
// La base local es la que decide si un código "ya entró": responde al instante
// y no depende de que Kommo esté disponible.
import { norm } from './kommo.js';

// El QR trae "M52-QDNMN" y, opcionalmente, el ID del lead: "M52-QDNMN-11404941".
const CODE_RE = /^(M52-[A-Z0-9]{4,10})(?:-(\d{4,}))?$/;

const PIN_MAX_FAILS = 10;
const PIN_WINDOW_MS = 10 * 60 * 1000;

const fieldValues = (entity) =>
  (entity?.custom_fields_values ?? []).flatMap((f) => (f.values ?? []).map((v) => String(v.value ?? '')));

const hasCode = (entity, code) =>
  !!entity &&
  [entity.name, ...fieldValues(entity)].some((v) => String(v ?? '').toUpperCase().includes(code));

const mainContactId = (lead) => {
  const list = lead?._embedded?.contacts ?? [];
  return (list.find((c) => c.is_main) ?? list[0])?.id ?? null;
};

function formatValue(field, value) {
  if (['date', 'date_time', 'birthday'].includes(field.field_type) && /^\d{9,}$/.test(String(value))) {
    return new Date(Number(value) * 1000).toLocaleDateString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
  return String(value);
}

function describe(lead, contact, code, stageName) {
  const phone = (contact?.custom_fields_values ?? []).find((f) => f.field_code === 'PHONE');
  const fields = (lead.custom_fields_values ?? [])
    .map((f) => ({
      name: f.field_name,
      value: (f.values ?? []).map((v) => formatValue(f, v.value)).join(', '),
    }))
    .filter((f) => f.value && !f.value.toUpperCase().includes(code));
  return {
    leadId: lead.id,
    name: contact?.name || lead.name,
    phone: phone?.values?.[0]?.value ?? null,
    code,
    stage: stageName,
    registeredAt: lead.created_at ? lead.created_at * 1000 : null,
    fields,
  };
}

// Comparación de PIN que no revela en qué carácter falla.
function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function createCore({ config, crm, store }) {
  // 'ok' | 'bad' | 'locked'. 10 PIN incorrectos en 10 minutos bloquean 10 minutos.
  async function pinCheck(header) {
    if (!config.pin) return 'ok';
    if ((await store.countPinFails(Date.now() - PIN_WINDOW_MS)) >= PIN_MAX_FAILS) return 'locked';
    if (header && safeEqual(header, config.pin)) return 'ok';
    if (header) await store.addPinFail(Date.now());
    return 'bad';
  }

  // Busca el lead del código dentro del pipeline y comprueba que el código le pertenezca.
  async function findLead(code, leadId, pipeline) {
    if (leadId) {
      const lead = await crm.getLead(leadId);
      if (!lead || lead.pipeline_id !== pipeline.id) return null;
      const contact = mainContactId(lead) ? await crm.getContact(mainContactId(lead)) : null;
      return hasCode(lead, code) || hasCode(contact, code) ? { lead, contact } : null;
    }
    const candidates = (await crm.searchLeads(code)).filter((l) => l.pipeline_id === pipeline.id);
    for (const lead of candidates) {
      const contact = mainContactId(lead) ? await crm.getContact(mainContactId(lead)) : null;
      if (hasCode(lead, code) || hasCode(contact, code)) return { lead, contact };
    }
    return null;
  }

  const usedResult = (entry) => ({
    result: 'used',
    message: 'Este QR ya fue usado para entrar.',
    person: entry.person,
    usedAt: entry.at,
  });

  async function runCheckin(raw) {
    const m = String(raw ?? '').trim().toUpperCase().match(CODE_RE);
    if (!m) return { result: 'invalid', message: 'Este QR no es de Lista 52.' };
    const [, code, leadId] = m;

    // 1. Si ya entró, se responde con la base local, sin tocar Kommo.
    const already = await store.get(code);
    if (already) return usedResult(already);

    // 2. Se busca el lead en Kommo y se revisa su etapa.
    const pipeline = await crm.getPipeline();
    const arrived = pipeline.stages.find((s) => norm(s.name) === norm(config.stageArrived));
    if (!arrived) throw new Error(`El pipeline no tiene la etapa "${config.stageArrived}".`);

    const found = await findLead(code, leadId, pipeline);
    if (!found) return { result: 'not_found', code, message: 'No hay ninguna inscripción con este código.' };

    const { lead, contact } = found;
    const stageName = pipeline.stages.find((s) => s.id === lead.status_id)?.name ?? 'Desconocida';

    if (lead.status_id === arrived.id) {
      // Marcado como Llegó en Kommo por otro camino (a mano, por ejemplo).
      return {
        result: 'used',
        message: 'Este QR ya fue usado para entrar.',
        person: describe(lead, contact, code, stageName),
      };
    }
    if (!config.stagesAllowed.includes(norm(stageName))) {
      return {
        result: 'rejected',
        message: `No puede entrar: su inscripción está en "${stageName}".`,
        person: describe(lead, contact, code, stageName),
      };
    }

    // 3. Se reserva el código en la base (atómico: si dos celulares escanean a la vez,
    //    solo uno lo consigue) y luego se actualiza Kommo.
    const person = describe(lead, contact, code, arrived.name);
    const claimed = await store.claim({
      code,
      leadId: lead.id,
      name: person.name,
      stageBefore: stageName,
      at: Date.now(),
      person,
    });
    if (!claimed) return usedResult(await store.get(code));

    try {
      await crm.moveLead(lead.id, pipeline.id, arrived.id);
    } catch (e) {
      await store.release(code); // Kommo falló: el código queda libre para reintentar
      throw e;
    }
    return { result: 'ok', message: 'Entrada registrada.', previousStage: stageName, person };
  }

  // Cada escaneo queda en el historial de la noche, haya entrado o no. Si falla el
  // registro no se interrumpe la taquilla: solo se anota en el log del servidor.
  async function record(scan) {
    try {
      await store.logScan({
        at: Date.now(),
        code: scan.code,
        result: scan.result,
        name: scan.person?.name ?? null,
        leadId: scan.person?.leadId ?? null,
        person: scan.person ?? null,
      });
    } catch (e) {
      console.error('[scan log]', e.message);
    }
  }

  async function checkin(raw) {
    const typed = String(raw ?? '').trim().toUpperCase().slice(0, 60);
    let out;
    try {
      out = await runCheckin(raw);
    } catch (e) {
      await record({ code: typed, result: 'error' });
      throw e;
    }
    await record({ code: out.person?.code ?? out.code ?? typed, result: out.result, person: out.person });
    return out;
  }

  const listEntries = (since = 0, limit = 1000) => store.list(since, limit);
  const listScans = (since = 0, limit = 300) => store.listScans(since, limit);

  async function entriesCsv(since = 0) {
    const rows = await store.list(since, 5000);
    const head = ['hora', 'codigo', 'nombre', 'telefono', 'lead_id', 'etapa_anterior'];
    const lines = rows.map((r) =>
      [
        new Date(r.at).toLocaleString('sv-SE', { timeZone: 'America/Bogota' }),
        r.code,
        r.name,
        r.person?.phone ?? '',
        r.leadId,
        r.stageBefore,
      ]
        .map(csvCell)
        .join(',')
    );
    return '﻿' + [head.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n';
  }

  return { pinCheck, checkin, listEntries, listScans, entriesCsv };
}
