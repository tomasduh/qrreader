// Diagnóstico de solo lectura contra Kommo: no modifica ningún lead.
// Uso: node --env-file=.env check.js
const sub = process.env.KOMMO_SUBDOMAIN || 'm52discobar';
const token = process.env.KOMMO_TOKEN;
const pipelineName = process.env.KOMMO_PIPELINE || 'Lista 52';
if (!token) {
  console.error('Falta KOMMO_TOKEN en .env');
  process.exit(1);
}

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

async function get(path) {
  const res = await fetch(`https://${sub}.kommo.com/api/v4${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`${res.status} en ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const CODE = /M52-[A-Z0-9]{4,10}/i;
const codesIn = (entity) => {
  const out = [];
  if (CODE.test(entity?.name ?? '')) out.push({ where: 'nombre', code: entity.name.match(CODE)[0] });
  for (const f of entity?.custom_fields_values ?? []) {
    for (const v of f.values ?? []) {
      const m = String(v.value ?? '').match(CODE);
      if (m) out.push({ where: `campo "${f.field_name}" (id ${f.field_id})`, code: m[0] });
    }
  }
  return out;
};

const pipelines = (await get('/leads/pipelines'))._embedded.pipelines;
const pipeline = pipelines.find((p) => norm(p.name) === norm(pipelineName));
if (!pipeline) {
  console.error(`No existe el pipeline "${pipelineName}". Hay: ${pipelines.map((p) => p.name).join(', ')}`);
  process.exit(1);
}
const stages = new Map(pipeline._embedded.statuses.map((s) => [s.id, s.name]));
console.log(`Pipeline "${pipeline.name}" (id ${pipeline.id})`);
console.log('Etapas:', [...stages].map(([id, n]) => `${n}=${id}`).join(', '));

const data = await get(`/leads?filter[pipeline_id][]=${pipeline.id}&with=contacts&limit=50`);
const leads = data?._embedded?.leads ?? [];
console.log(`\nLeads en el pipeline: ${leads.length}`);

let sample = null;
for (const lead of leads) {
  let found = codesIn(lead).map((c) => ({ ...c, where: `lead: ${c.where}` }));
  const contactId = (lead._embedded?.contacts ?? [])[0]?.id;
  if (!found.length && contactId) {
    const contact = await get(`/contacts/${contactId}`);
    found = codesIn(contact).map((c) => ({ ...c, where: `contacto: ${c.where}` }));
  }
  const fieldNames = (lead.custom_fields_values ?? []).map((f) => f.field_name).join(', ') || 'ninguno';
  console.log(
    `- lead ${lead.id} [${stages.get(lead.status_id) ?? lead.status_id}] ` +
      (found.length ? found.map((c) => `${c.code} en ${c.where}`).join('; ') : 'SIN código') +
      ` | campos del lead: ${fieldNames}`
  );
  if (found.length && !sample) sample = { id: lead.id, code: found[0].code.toUpperCase() };
}

if (sample) {
  const res = await get(`/leads?query=${encodeURIComponent(sample.code)}&limit=50`);
  const ids = (res?._embedded?.leads ?? []).map((l) => l.id);
  console.log(`\nBúsqueda ?query=${sample.code}: ${ids.length} resultado(s) -> ${ids.join(', ') || 'ninguno'}`);
  console.log(ids.includes(sample.id) ? 'OK: la búsqueda por código encuentra el lead.' : 'PROBLEMA: la búsqueda por código NO encuentra el lead.');
} else {
  console.log('\nNingún lead tiene el código en su nombre ni en campos personalizados.');
}
