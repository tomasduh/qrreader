const $ = (id) => document.getElementById(id);

const els = {
  video: $('video'),
  viewport: $('viewport'),
  idle: $('idle'),
  startBtn: $('startBtn'),
  stopBtn: $('stopBtn'),
  scanStatus: $('scanStatus'),
  csvBtn: $('csvBtn'),
  cameraHint: $('cameraHint'),
  manualForm: $('manualForm'),
  codeInput: $('codeInput'),
  result: $('result'),
  resultTitle: $('resultTitle'),
  resultName: $('resultName'),
  resultCedula: $('resultCedula'),
  resultWarn: $('resultWarn'),
  resultMessage: $('resultMessage'),
  resultDetails: $('resultDetails'),
  nextBtn: $('nextBtn'),
  loading: $('loading'),
  logList: $('logList'),
  logEmpty: $('logEmpty'),
  countOk: $('countOk'),
  demoTag: $('demoTag'),
  pinDialog: $('pinDialog'),
  pinForm: $('pinForm'),
  pinInput: $('pinInput'),
  pinError: $('pinError'),
};

const VERDICTS = {
  ok: 'Puede entrar',
  used: 'Ya entró',
  rejected: 'No puede entrar',
  not_found: 'Código no encontrado',
  invalid: 'QR no válido',
  busy: 'Espera un momento',
  error: 'No se pudo validar',
};

const TONES = { ok: 'var(--ok)', used: 'var(--warn)' };

let pin = sessionStorage.getItem('m52pin') || '';
let stream = null;
let scanning = false;
let busy = false;
let cameraWasOn = false;
let okCount = 0;

// ---------- API ----------

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-pin': pin, ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// Las entradas guardadas en el servidor de las últimas 18 horas forman "Esta noche".
const NIGHT_MS = 18 * 3600 * 1000;

async function loadEntries() {
  try {
    const { status, data } = await api(`/api/scans?since=${Date.now() - NIGHT_MS}`);
    if (status !== 200) return;
    els.logList.replaceChildren();
    okCount = 0;
    els.countOk.textContent = '0';
    els.logEmpty.hidden = false;
    // Vienen de la más nueva a la más vieja; addToLog agrega arriba, así que se invierte.
    for (const s of [...data.scans].reverse()) {
      addToLog({ result: s.result, person: s.person, code: s.code }, s.at);
    }
  } catch {
    /* el historial es opcional: la taquilla sigue funcionando sin él */
  }
}

async function downloadCsv() {
  const { status } = await fetch(`/api/entries.csv?since=${Date.now() - NIGHT_MS}`, {
    headers: { 'x-pin': pin },
  }).then(async (res) => {
    if (res.ok) {
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `entradas-lista-52-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
    return res;
  });
  if (status === 401) askPin(true);
}

async function init() {
  try {
    const { data } = await api('/api/status');
    els.demoTag.hidden = data.mode !== 'demo';
    if (data.pinRequired && !data.pinValid) askPin(false);
    else loadEntries();
  } catch {
    showResult({ result: 'error', message: 'No hay conexión con el servidor de taquilla.' });
  }
}

function askPin(showError) {
  els.pinError.hidden = !showError;
  els.pinInput.value = '';
  if (!els.pinDialog.open) els.pinDialog.showModal();
  els.pinInput.focus();
}

els.pinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  pin = els.pinInput.value.trim();
  const { data } = await api('/api/status');
  if (data.pinValid) {
    sessionStorage.setItem('m52pin', pin);
    els.pinDialog.close();
    loadEntries();
  } else {
    askPin(true);
  }
});
els.pinDialog.addEventListener('cancel', (e) => e.preventDefault());

// ---------- Validación ----------

async function validate(code) {
  if (busy) return;
  busy = true;
  els.loading.hidden = false;
  try {
    const { status, data } = await api('/api/checkin', { method: 'POST', body: JSON.stringify({ code }) });
    if (status === 401) {
      askPin(true);
      return;
    }
    showResult(data.result ? data : { result: 'error', message: 'Respuesta inesperada del servidor.' });
  } catch {
    showResult({ result: 'error', message: 'Sin conexión. Revisa el internet e inténtalo otra vez.' });
  } finally {
    els.loading.hidden = true;
    busy = false;
  }
}

function showResult(data) {
  cameraWasOn = scanning;
  scanning = false;

  const person = data.person;
  els.result.dataset.result = data.result;
  els.resultTitle.textContent = VERDICTS[data.result] || VERDICTS.error;
  els.resultName.textContent = person?.name || data.code || '';
  els.resultName.hidden = !els.resultName.textContent;

  // La cédula va grande: es lo que la taquilla compara con el documento de la persona.
  // cedula === undefined son entradas guardadas antes de este cambio: no se avisa nada.
  const cedula = person?.cedula;
  els.resultCedula.hidden = !cedula;
  els.resultCedula.textContent = cedula ? 'Cédula ' + (/^\d+$/.test(cedula) ? Number(cedula).toLocaleString('es-CO') : cedula) : '';
  const warning = !person
    ? ''
    : person.cedula === null
      ? 'Sin cédula registrada en Kommo. Pide el documento y verifícalo a mano.'
      : person.cedulaMismatch
        ? 'La cédula del contacto y la de la lista no coinciden. Revisa bien el documento.'
        : '';
  els.resultWarn.hidden = !warning;
  els.resultWarn.textContent = warning;
  els.resultMessage.textContent = data.message || '';

  const rows = [];
  if (person) {
    rows.push(['Código', person.code]);
    if (person.phone) rows.push(['Teléfono', person.phone]);
    rows.push(['Estado en Kommo', person.stage]);
    if (data.previousStage) rows.push(['Estado anterior', data.previousStage]);
    for (const f of person.fields || []) rows.push([f.name, f.value]);
    if (data.usedAt) {
      rows.push(['Entró a las', new Date(data.usedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })]);
    }
    if (person.registeredAt) {
      rows.push(['Se inscribió', new Date(person.registeredAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })]);
    }
  }
  els.resultDetails.replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    })
  );

  els.result.hidden = false;
  els.nextBtn.focus();
  if (navigator.vibrate) navigator.vibrate(data.result === 'ok' ? 80 : [120, 80, 120]);
  if (data.result !== 'error' && data.result !== 'busy') addToLog(data);
}

function addToLog(data, at = Date.now()) {
  if (data.result === 'ok') els.countOk.textContent = String(++okCount);
  const li = document.createElement('li');
  li.style.setProperty('--tone', TONES[data.result] || 'var(--bad)');
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = data.person?.name || data.code || 'QR desconocido';
  const small = document.createElement('small');
  small.textContent = VERDICTS[data.result];
  who.append(small);
  const time = document.createElement('time');
  time.textContent = new Date(at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  li.append(who, time);
  els.logList.prepend(li);
  els.logEmpty.hidden = true;
}

els.nextBtn.addEventListener('click', () => {
  els.result.hidden = true;
  els.codeInput.value = '';
  if (cameraWasOn && stream) {
    scanning = true;
    requestAnimationFrame(scanLoop);
  }
});

els.manualForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = els.codeInput.value.trim();
  if (code) validate(code);
});

// ---------- Cámara ----------

// Tres lectores en cadena: el nativo del navegador, OpenCV y jsQR.
// OpenCV es el que importa: los QR de Lista 52 llevan un logo que tapa el 40% del
// centro, y con eso ZXing no lee nada y jsQR acierta muy pocas veces.
const OPENCV_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js';
let cvLib = null;
let cvDetector = null;
let cvLoading = null;
let cvSawQr = false;

function loadOpenCv() {
  if (cvLoading) return cvLoading;
  cvLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = OPENCV_URL;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('No se pudo descargar el lector de QR'));
    document.head.append(s);
  })
    .then(async () => {
      // Según la versión, window.cv es el módulo o una promesa del módulo. Se espera
      // sondeando hasta que esté inicializado (hasta 60 s).
      let resolved = null;
      if (window.cv instanceof Promise) window.cv.then((m) => (resolved = m));
      for (let i = 0; i < 600; i++) {
        const m = resolved || window.cv;
        if (m && m.Mat && m.QRCodeDetector) {
          cvDetector = new m.QRCodeDetector();
          cvLib = m;
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('El lector de QR no terminó de iniciar');
    })
    .catch((e) => {
      console.warn(e);
      cvLoading = null;
    });
  return cvLoading;
}

function readLogoQr(gray, corners) {
  const N = window.LogoQR?.N;
  if (!N) return null;
  const MODULE = 10;
  const side = N * MODULE;
  const src = cvLib.matFromArray(4, 1, cvLib.CV_32FC2, Array.from(corners).slice(0, 8));
  const dst = cvLib.matFromArray(4, 1, cvLib.CV_32FC2, [0, 0, side, 0, side, side, 0, side]);
  const warp = cvLib.getPerspectiveTransform(src, dst);
  const flat = new cvLib.Mat();
  const bin = new cvLib.Mat();
  try {
    cvLib.warpPerspective(gray, flat, warp, new cvLib.Size(side, side));
    cvLib.threshold(flat, bin, 0, 255, cvLib.THRESH_BINARY | cvLib.THRESH_OTSU);
    const px = bin.data;
    const grid = [];
    for (let y = 0; y < N; y++) {
      const row = [];
      for (let x = 0; x < N; x++) {
        let dark = 0;
        for (let dy = 3; dy < 7; dy++) {
          for (let dx = 3; dx < 7; dx++) if (px[(y * MODULE + dy) * side + x * MODULE + dx] < 128) dark++;
        }
        row.push(dark > 8 ? 1 : 0);
      }
      grid.push(row);
    }
    return window.LogoQR.decodeGrid(grid);
  } finally {
    src.delete();
    dst.delete();
    warp.delete();
    flat.delete();
    bin.delete();
  }
}

function decodeWithOpenCv(imageData) {
  const mat = cvLib.matFromImageData(imageData);
  const gray = new cvLib.Mat();
  const points = new cvLib.Mat();
  try {
    cvLib.cvtColor(mat, gray, cvLib.COLOR_RGBA2GRAY);
    const text = cvDetector.detectAndDecode(gray, points);
    if (text) return text;
    // OpenCV ubicó el QR pero no pudo leerlo (casi siempre por el logo del centro):
    // se endereza, se muestrea la cuadrícula y se lee tratando el logo como borrado.
    if (points.rows > 0 && points.data32F && points.data32F.length >= 8) {
      cvSawQr = true;
      return readLogoQr(gray, points.data32F);
    }
    return null;
  } catch {
    return null;
  } finally {
    mat.delete();
    gray.delete();
    points.delete();
  }
}

let detector = null;
try {
  if ('BarcodeDetector' in window) detector = new BarcodeDetector({ formats: ['qr_code'] });
} catch {
  detector = null;
}
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
let frames = 0;

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

// Recorta el cuadrado central del video, que es lo que se ve en pantalla.
function grabSquare(v, size) {
  const side = Math.min(v.videoWidth, v.videoHeight);
  const out = Math.min(size, side);
  canvas.width = out;
  canvas.height = out;
  ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, out, out);
  return ctx.getImageData(0, 0, out, out);
}

async function readFrame() {
  const v = els.video;
  if (v.readyState < 2 || !v.videoWidth) return null;

  if (detector) {
    try {
      const found = await withTimeout(detector.detect(v), 500);
      if (found?.length) return found[0].rawValue;
    } catch {
      detector = null;
    }
  }

  // OpenCV a dos tamaños: uno grande para QR lejanos y uno chico que tolera mejor el desenfoque.
  if (cvLib) {
    for (const size of [800, 480]) {
      const value = decodeWithOpenCv(grabSquare(v, size));
      if (value) return value;
    }
  }

  const img = grabSquare(v, 640);
  if (window.jsQR) {
    return window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data || null;
  }
  return null;
}

async function scanLoop() {
  if (!scanning) return;
  let value = null;
  try {
    value = await readFrame();
    frames++;
    if (frames % 5 === 0) {
      els.scanStatus.textContent = cvSawQr
        ? 'Veo un QR pero no lo leo: acércalo o dale luz'
        : (cvLib ? 'Buscando QR' : 'Cargando lector') + '.'.repeat((frames / 5) % 4);
      cvSawQr = false;
    }
  } catch (e) {
    els.scanStatus.textContent = 'Error del lector: ' + e.message;
  }
  if (!scanning) return;
  if (value) {
    await validate(value);
    if (!scanning) return;
  }
  setTimeout(() => requestAnimationFrame(scanLoop), 80);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraError('Este navegador no deja usar la cámara aquí. Abre la página con https o escribe el código.');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    // Enfoque continuo, donde el celular lo permita.
    const track = stream.getVideoTracks()[0];
    if (track.getCapabilities?.().focusMode?.includes('continuous')) {
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    }
  } catch (e) {
    cameraError(
      e.name === 'NotAllowedError'
        ? 'La cámara está bloqueada. Dale permiso en el navegador y vuelve a intentarlo.'
        : 'No se encontró una cámara. Escribe el código abajo.'
    );
    return;
  }
  els.video.srcObject = stream;
  els.video.hidden = false;
  await els.video.play();
  els.idle.hidden = true;
  els.stopBtn.hidden = false;
  els.scanStatus.hidden = false;
  els.scanStatus.textContent = cvLib ? 'Buscando QR' : 'Cargando lector';
  loadOpenCv();
  els.viewport.classList.add('live');
  scanning = true;
  scanLoop();
}

function stopCamera() {
  scanning = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  els.video.hidden = true;
  els.idle.hidden = false;
  els.stopBtn.hidden = true;
  els.scanStatus.hidden = true;
  els.viewport.classList.remove('live');
}

function cameraError(text) {
  els.cameraHint.textContent = text;
  els.cameraHint.classList.add('error');
}

els.csvBtn.addEventListener('click', downloadCsv);
els.startBtn.addEventListener('click', startCamera);
els.stopBtn.addEventListener('click', stopCamera);

init();
loadOpenCv(); // pesa unos 10 MB: se descarga al abrir la página para que esté listo al escanear
