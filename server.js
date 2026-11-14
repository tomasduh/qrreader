// Servidor Node: mismo código que el Worker de Cloudflare, con SQLite en un archivo.
// Sirve para probar en local, o para publicarlo en un VPS o en Fly.io.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfig, createCrm } from './config.js';
import { createApi } from './api.js';
import { sqliteStore } from './store-sqlite.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- .env ----------

function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const config = buildConfig((name) => process.env[name]);
const port = Number(process.env.PORT) || 3000;
const dbFile = process.env.DB_FILE || path.join(__dirname, 'data', 'm52.db');
const crm = createCrm(config);
const api = createApi({ config, crm, store: sqliteStore(dbFile) });

// ---------- HTTP ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10000) reject(new Error('Cuerpo demasiado grande'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname.startsWith('/api/')) {
        const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
        const request = new Request(url, {
          method: req.method,
          headers: { 'x-pin': req.headers['x-pin'] ?? '', 'content-type': req.headers['content-type'] ?? '' },
          body: hasBody ? await readBody(req) : undefined,
        });
        const response = await api(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        return res.end(Buffer.from(await response.arrayBuffer()));
      }

      if (req.method !== 'GET') {
        res.writeHead(405);
        return res.end();
      }
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const root = path.join(__dirname, 'public');
      const file = path.join(root, rel);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('No encontrado');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      console.error('[server]', e);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error del servidor');
    }
  })
  .listen(port, () => {
    console.log(`Taquilla M52 en http://localhost:${port}`);
    console.log(`Base de datos: ${dbFile}`);
    console.log(
      crm.mode === 'demo'
        ? 'Modo DEMO: no hay KOMMO_TOKEN, se usan leads de prueba en memoria.'
        : `Conectado a ${config.subdomain}.kommo.com, pipeline "${config.pipelineName}".`
    );
  });
