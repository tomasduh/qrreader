# Taquilla M52

Web para validar en la puerta los QR de Lista 52. Lee el QR con la cámara, busca el lead en
Kommo, lo pasa a la etapa "Llegó" y muestra los datos de la persona. Guarda el historial de
escaneos en SQLite (D1 en Cloudflare) para no depender de Kommo en la puerta.

## Estructura

| Archivo | Qué hace |
|---|---|
| `public/` | La web: cámara, resultado a pantalla completa, historial de la noche |
| `public/logoqr.js` | Lector de QR con logo grande en el centro (los de quickchart.io de Lista 52) |
| `core.js` | Reglas de validación y PIN. No depende de dónde corre |
| `api.js` | Rutas `/api/*` con `Request`/`Response` estándar |
| `kommo.js` | Llamadas a la API de Kommo y un CRM de demostración |
| `config.js` | Lee la configuración (variables de entorno) |
| `src/worker.js` + `store-d1.js` | Arranque en Cloudflare Workers con D1 |
| `server.js` + `store-sqlite.js` | Arranque en Node con un archivo SQLite |
| `migrations/` | Esquema de la base D1 |
| `check.js` | Diagnóstico de solo lectura contra Kommo |

## Cómo valida

1. El QR trae un código `M52-XXXXX`.
2. Si el código ya está en la base local, responde "Ya entró" al instante.
3. Si no, lo busca en Kommo (`?query=`) dentro del pipeline "Lista 52" y comprueba que el lead
   tenga ese código en su nombre o en un campo personalizado.
4. Si el lead está en Inscrito o Reconfirmó, reserva el código en la base (si dos celulares
   escanean a la vez, solo uno lo consigue) y mueve el lead a "Llegó".

Cada escaneo, haya entrado o no, queda en el historial (`scans`). Las entradas exitosas
también se guardan en `entries`, y se pueden descargar como CSV.

## Probar en local

```bash
npm start
```

Abre http://localhost:3000. Sin `KOMMO_TOKEN` arranca en **modo demo** con leads de prueba en
memoria (`M52-QDNMN`, `M52-ABCDE`, `M52-USADO`, `M52-CANCE`, `M52-ESPER`). La base queda en
`data/m52.db`. Hace falta Node 22 o superior.

Para probar el Worker con D1 local:

```bash
npm run cf:db
npm run cf:dev
```

## Configuración

Variables (ver `.env.example` y `wrangler.toml`):

- `KOMMO_SUBDOMAIN`, `KOMMO_PIPELINE`, `STAGE_ARRIVED`, `STAGES_ALLOWED`: nombres tal como están en Kommo.
- `KOMMO_TOKEN`: token de larga duración de la integración privada (secreto).
- `APP_PIN`: PIN de la web (secreto). 10 intentos fallidos en 10 minutos bloquean 10 minutos.

## Publicar en Cloudflare

```bash
npx wrangler login
npx wrangler d1 create taquilla-m52          # pegar el database_id en wrangler.toml
npx wrangler d1 migrations apply taquilla-m52 --remote
npx wrangler secret put KOMMO_TOKEN
npx wrangler secret put APP_PIN
npx wrangler deploy
```

El subdominio se configura en `routes` de `wrangler.toml`. El dominio tiene que estar en la
misma cuenta de Cloudflare que el Worker.

## Pendiente

- El Salesbot "L52 Inscripción" no guarda el código en todos los leads; esos QR salen como
  "Código no encontrado".
- Probar un cambio real a "Llegó" desde el Worker con un lead de prueba.
- Bajar `centerImageSizeRatio` de 0.4 a 0.2 en la URL del QR para que cualquier lector los lea.
