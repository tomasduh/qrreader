// Punto de entrada en Cloudflare Workers. La web (public/) la sirve Cloudflare como
// archivos estáticos; este código solo atiende /api/* (ver wrangler.toml).
import { buildConfig, createCrm } from '../config.js';
import { createApi } from '../api.js';
import { d1Store } from '../store-d1.js';

let api = null;

export default {
  async fetch(request, env) {
    // Se arma una vez por instancia; así el pipeline de Kommo queda en caché entre peticiones.
    if (!api) {
      const config = buildConfig((name) => env[name]);
      api = createApi({ config, crm: createCrm(config), store: d1Store(env.DB) });
    }
    return (await api(request)) ?? env.ASSETS.fetch(request);
  },
};
