// Lector de QR con logo grande en el centro.
//
// Los QR de Lista 52 los genera quickchart.io con un logo que cubre el 40% del
// ancho. El logo borra módulos del centro, y los lectores normales (incluido
// OpenCV en 2 de cada 3 códigos) los descartan porque el daño supera lo que
// corrigen como "errores". Aquí se trata el centro como *borrado*: se sabe qué
// módulos faltan, y con nivel de corrección H un QR versión 1 (21x21, 9 bytes de
// datos y 17 de corrección) recupera hasta 17 bytes borrados.
//
// Solo versión 1 con nivel H, que es lo que genera el chatbot ("M52-XXXXX").
// decodeGrid recibe la cuadrícula ya muestreada (21 filas de 21 valores 0/1,
// 1 = módulo negro) y devuelve el texto, o null si no cuadra.
(function (root) {
  const N = 21;
  const TOTAL = 26; // bytes totales
  const EC = 17; // bytes de corrección
  const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

  // ---- Campo de Galois GF(256), polinomio 0x11D ----
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
  const inv = (a) => EXP[255 - LOG[a]];

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  const isFunction = (x, y) =>
    (x < 9 && y < 9) || (x >= N - 8 && y < 9) || (x < 9 && y >= N - 8) || x === 6 || y === 6;

  // Orden de lectura de los módulos de datos (zigzag de a dos columnas).
  const ORDER = (() => {
    const out = [];
    for (let right = N - 1; right > 0; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < N; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? N - 1 - vert : vert;
          if (!isFunction(x, y)) out.push([y, x]);
        }
      }
    }
    return out;
  })();

  // ---- Información de formato (nivel de corrección + máscara) ----
  const FORMATS = (() => {
    const list = [];
    for (let d = 0; d < 32; d++) {
      let r = d << 10;
      for (let i = 14; i >= 10; i--) if ((r >> i) & 1) r ^= 0x537 << (i - 10);
      list.push({ data: d, code: ((d << 10) | r) ^ 0x5412 });
    }
    return list;
  })();

  const popcount = (v) => {
    let n = 0;
    for (; v; v &= v - 1) n++;
    return n;
  };

  function readFormat(g) {
    const bits = [];
    for (let i = 0; i < 6; i++) bits.push(g[i][8]);
    bits.push(g[7][8], g[8][8], g[8][7]);
    for (let i = 9; i < 15; i++) bits.push(g[8][14 - i]);
    let v = 0;
    bits.forEach((b, i) => (v |= (b ? 1 : 0) << i));
    let best = null;
    for (const f of FORMATS) {
      const dist = popcount(f.code ^ v);
      if (!best || dist < best.dist) best = { dist, data: f.data };
    }
    return best;
  }

  const rotate = (g) => Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => g[N - 1 - x][y]));

  // ---- Reed-Solomon: recuperar bytes borrados (posiciones conocidas) ----
  function syndromes(cw) {
    const s = [];
    for (let j = 0; j < EC; j++) {
      let acc = 0;
      for (let k = 0; k < TOTAL; k++) if (cw[k]) acc ^= mul(cw[k], EXP[(j * (TOTAL - 1 - k)) % 255]);
      s.push(acc);
    }
    return s;
  }

  function recoverErasures(cw, erased) {
    const e = erased.length;
    if (e === 0) return syndromes(cw).every((v) => v === 0) ? cw : null;
    if (e > EC) return null;
    const work = cw.slice();
    for (const k of erased) work[k] = 0;
    const s = syndromes(work);
    // Sistema A·y = s, con A[j][p] = X_p^j y X_p = α^(posición).
    const A = [];
    for (let j = 0; j < e; j++) {
      const row = erased.map((k) => EXP[(j * (TOTAL - 1 - k)) % 255]);
      row.push(s[j]);
      A.push(row);
    }
    for (let c = 0; c < e; c++) {
      let p = c;
      while (p < e && A[p][c] === 0) p++;
      if (p === e) return null;
      [A[c], A[p]] = [A[p], A[c]];
      const iv = inv(A[c][c]);
      for (let k = c; k <= e; k++) A[c][k] = mul(A[c][k], iv);
      for (let r = 0; r < e; r++) {
        if (r === c || A[r][c] === 0) continue;
        const f = A[r][c];
        for (let k = c; k <= e; k++) A[r][k] ^= mul(f, A[c][k]);
      }
    }
    erased.forEach((k, i) => (work[k] = A[i][e]));
    // Con menos de 17 borrados sobran ecuaciones: todas deben cuadrar.
    return syndromes(work).every((v) => v === 0) ? work : null;
  }

  function parse(data) {
    let bits = '';
    for (const b of data) bits += b.toString(2).padStart(8, '0');
    const mode = bits.slice(0, 4);
    if (mode === '0010') {
      let n = parseInt(bits.slice(4, 13), 2);
      let p = 13;
      let s = '';
      while (n >= 2) {
        const v = parseInt(bits.slice(p, p + 11), 2);
        if (v >= 45 * 45) return null;
        s += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45];
        p += 11;
        n -= 2;
      }
      if (n === 1) {
        const v = parseInt(bits.slice(p, p + 6), 2);
        if (v >= 45) return null;
        s += ALNUM[v];
      }
      return s;
    }
    if (mode === '0100') {
      const n = parseInt(bits.slice(4, 12), 2);
      if (12 + 8 * n > bits.length) return null;
      let s = '';
      for (let i = 0; i < n; i++) s += String.fromCharCode(parseInt(bits.slice(12 + 8 * i, 20 + 8 * i), 2));
      return s;
    }
    return null;
  }

  // Rectángulos (columna/fila inicial y final) que se tratan como borrados, de menor a mayor.
  const LOGO_AREAS = [
    [7, 13, 7, 13],
    [6, 14, 6, 14],
    [5, 15, 5, 15],
  ];

  function decodeOriented(g) {
    const fmt = readFormat(g);
    if (fmt.dist > 3) return null;
    const mask = fmt.data & 7;
    const cw = new Array(TOTAL).fill(0);
    ORDER.forEach(([y, x], i) => {
      const bit = (g[y][x] ? 1 : 0) ^ (MASKS[mask](x, y) ? 1 : 0);
      cw[i >> 3] = (cw[i >> 3] << 1) | bit;
    });
    for (const [x0, x1, y0, y1] of LOGO_AREAS) {
      const erased = new Set();
      ORDER.forEach(([y, x], i) => {
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) erased.add(i >> 3);
      });
      const base = [...erased].sort((a, b) => a - b);
      const rest = [];
      for (let k = 0; k < TOTAL; k++) if (!erased.has(k)) rest.push(k);
      // Primero solo el logo; si no cuadra, se prueba descartar también 1 o 2 bytes
      // sueltos (módulos mal leídos por la cámara). Sobran ecuaciones de sobra para
      // que un resultado falso no pase la verificación.
      const tries = [[]];
      rest.forEach((a) => tries.push([a]));
      if (base.length <= 11) rest.forEach((a, i) => rest.slice(i + 1).forEach((b) => tries.push([a, b])));
      for (const extra of tries) {
        const fixed = recoverErasures(cw, [...base, ...extra].sort((a, b) => a - b));
        if (fixed) {
          const text = parse(fixed.slice(0, TOTAL - EC));
          if (text) return text;
        }
      }
    }
    return null;
  }

  // La orientación del QR en la imagen es desconocida: se prueban los 4 giros.
  function decodeGrid(grid) {
    let g = grid;
    for (let r = 0; r < 4; r++) {
      const text = decodeOriented(g);
      if (text) return text;
      g = rotate(g);
    }
    return null;
  }

  root.LogoQR = { decodeGrid, N };
  if (typeof module !== 'undefined') module.exports = root.LogoQR;
})(typeof window !== 'undefined' ? window : globalThis);
