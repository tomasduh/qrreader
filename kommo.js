// Acceso a los leads. Dos implementaciones con la misma interfaz:
// la real (API de Kommo) y una demo en memoria para probar sin token.

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

export { norm };

export function createKommo({ subdomain, token, pipelineName }) {
  const base = `https://${subdomain}.kommo.com/api/v4`;
  let pipelineCache = null;

  async function call(path, options = {}) {
    const res = await fetch(base + path, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 204) return null;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Kommo respondió ${res.status} en ${path}`);
      err.status = res.status;
      err.body = body.slice(0, 300);
      throw err;
    }
    return res.json();
  }

  // Pipeline "Lista 52" con sus etapas: { id, name, stages: [{ id, name }] }
  async function getPipeline() {
    if (pipelineCache) return pipelineCache;
    const data = await call('/leads/pipelines');
    const all = data?._embedded?.pipelines ?? [];
    const found = all.find((p) => norm(p.name) === norm(pipelineName));
    if (!found) {
      throw new Error(
        `No existe el pipeline "${pipelineName}". Disponibles: ${all.map((p) => p.name).join(', ')}`
      );
    }
    pipelineCache = {
      id: found.id,
      name: found.name,
      stages: (found._embedded?.statuses ?? []).map((s) => ({ id: s.id, name: s.name })),
    };
    return pipelineCache;
  }

  async function getLead(id) {
    try {
      return await call(`/leads/${id}?with=contacts`);
    } catch (e) {
      if (e.status === 404 || e.status === 400) return null;
      throw e;
    }
  }

  async function searchLeads(query) {
    const data = await call(`/leads?query=${encodeURIComponent(query)}&with=contacts&limit=50`);
    return data?._embedded?.leads ?? [];
  }

  async function getContact(id) {
    try {
      return await call(`/contacts/${id}`);
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async function moveLead(id, pipelineId, statusId) {
    await call(`/leads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ pipeline_id: pipelineId, status_id: statusId }),
    });
  }

  return { mode: 'kommo', getPipeline, getLead, searchLeads, getContact, moveLead };
}

// ---------- Demo ----------

export function createDemo({ pipelineName }) {
  const pipeline = {
    id: 1,
    name: pipelineName,
    stages: [
      { id: 10, name: 'Inscrito' },
      { id: 11, name: 'Reconfirmó' },
      { id: 12, name: 'Lista de espera' },
      { id: 13, name: 'Canceló' },
      { id: 14, name: 'Llegó' },
      { id: 15, name: 'No-show' },
    ],
  };

  const field = (name, value, type = 'text') => ({
    field_id: 0,
    field_name: name,
    field_type: type,
    values: [{ value }],
  });

  const seed = [
    // código, nombre, teléfono, etapa, cumpleaños, cédula del contacto, "Cédula lista" del lead
    ['M52-QDNMN', 'Laura Pérez Gómez', '+57 300 111 2233', 10, '21/07', '1012345678', '1012345678'],
    ['M52-ABCDE', 'Andrés Rojas', '+57 301 444 5566', 11, '03/12', '1005342884', '...'],
    ['M52-USADO', 'Camila Torres', '+57 302 777 8899', 14, '15/02', null, null],
    ['M52-CANCE', 'Julián Castro', '+57 303 222 3344', 13, '30/09', '79111222', '80999888'],
    ['M52-ESPER', 'Valentina Ruiz', '+57 304 555 6677', 12, '08/05', '52333444', null],
  ];

  const leads = new Map();
  const contacts = new Map();
  seed.forEach(([code, name, phone, statusId, birthday, contactCedula, listCedula], i) => {
    const id = 11404900 + i;
    leads.set(id, {
      id,
      name,
      status_id: statusId,
      pipeline_id: pipeline.id,
      created_at: Math.floor(Date.now() / 1000) - 86400 * (i + 1),
      custom_fields_values: [
        field('Código Lista 52', code),
        field('Cumpleaños', birthday),
        ...(listCedula ? [field('Cédula lista', listCedula)] : []),
      ],
      _embedded: { contacts: [{ id: id + 1000, is_main: true }] },
    });
    contacts.set(id + 1000, {
      id: id + 1000,
      name,
      custom_fields_values: [
        { ...field('Teléfono', phone), field_code: 'PHONE' },
        ...(contactCedula ? [field('Cédula', contactCedula, 'numeric')] : []),
      ],
    });
  });

  return {
    mode: 'demo',
    getPipeline: async () => pipeline,
    getLead: async (id) => leads.get(Number(id)) ?? null,
    searchLeads: async (query) =>
      [...leads.values()].filter((l) => JSON.stringify(l).toUpperCase().includes(query.toUpperCase())),
    getContact: async (id) => contacts.get(Number(id)) ?? null,
    moveLead: async (id, _pipelineId, statusId) => {
      const lead = leads.get(Number(id));
      if (lead) lead.status_id = statusId;
    },
  };
}
