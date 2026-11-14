// Configuración compartida por el servidor Node y el Worker de Cloudflare.
// `get` lee una variable por nombre: process.env en Node, `env` en el Worker.
import { createKommo, createDemo, norm } from './kommo.js';

export function buildConfig(get) {
  return {
    subdomain: get('KOMMO_SUBDOMAIN') || 'm52discobar',
    token: get('KOMMO_TOKEN') || '',
    pipelineName: get('KOMMO_PIPELINE') || 'Lista 52',
    stageArrived: get('STAGE_ARRIVED') || 'Llegó',
    stagesAllowed: (get('STAGES_ALLOWED') || 'Inscrito,Reconfirmó').split(',').map(norm).filter(Boolean),
    pin: get('APP_PIN') || '',
  };
}

// Sin token se usa el CRM de demostración (leads de prueba en memoria).
export function createCrm(config) {
  return config.token ? createKommo(config) : createDemo(config);
}
