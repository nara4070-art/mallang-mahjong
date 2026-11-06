// Shared by the browser and the Worker so level rules / scoring are identical on both sides.
export const MAX_LEVEL = 500;

export const FACES = [
  '🐶','🐱','🐰','🐻','🐼','🐨','🐯','🦊','🐸','🐷','🐹','🐥','🐧','🦄','🐮','🐵',
  '🐔','🐙','🦁','🐳','🐬','🦋','🐞','🐢','🦔','🦦','🐣','🦩',
  '🍓','🍑','🍰','🌸','🍒','🍩','🍦','🧁','🍭','🌻','🍀','⭐','🌈','🍄','🎀','🍉','🍋','🍪'
];

export const KIND_LABEL = { normal: '보통', hard: '어려움', veryhard: '매우 어려움' };

export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rand = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function levelInfo(lv) {
  lv = Math.max(1, Math.min(MAX_LEVEL, lv | 0));
  const t = (lv - 1) / (MAX_LEVEL - 1);
  const kind = lv % 10 === 0 ? 'veryhard' : lv % 5 === 0 ? 'hard' : 'normal';

  let pairs = 12 + 58 * Math.pow(t, 0.7);         // 24 → 140 tiles
  let faces = 6 + 30 * Math.pow(t, 0.8);          // more kinds = harder to spot
  let secPerPair = 9 - 5 * Math.pow(t, 0.6);      // 9s → 4s per pair
  const layers = Math.min(5, 1 + Math.ceil(lv / 30));
  let shuffles = 3, fog = false, mult = 1;

  if (kind === 'hard')     { pairs *= 1.15; faces += 4; secPerPair *= 0.82; shuffles = 2; mult = 1.5; }
  if (kind === 'veryhard') { pairs *= 1.3;  faces += 8; secPerPair *= 0.7;  shuffles = 1; mult = 2; fog = lv >= 20; }

  pairs = Math.min(80, Math.round(pairs));
  faces = Math.min(FACES.length, pairs, Math.round(faces));
  const timeLimit = Math.max(40, Math.round(pairs * secPerPair / 5) * 5);
  return { lv, kind, pairs, faces, layers, timeLimit, shuffles, fog, mult };
}

// Pyramid layout in half-tile units: [x, y, z]
export function buildLayout(info) {
  const T = info.pairs * 2;
  let best = null;
  for (let h = 2; h <= 10; h++) for (let w = h; w <= 16; w++) {
    const dims = []; let sum = 0;
    for (let k = 0; k < info.layers; k++) {
      const a = w - 2 * k, b = h - 2 * k;
      if (a < 1 || b < 1) break;
      dims.push([a, b]); sum += a * b;
    }
    if (sum < T) continue;
    const score = (sum - T) + Math.abs(w / h - 1.5) * 4;
    if (!best || score < best.score) best = { score, dims, sum };
  }
  const layers = best.dims.map(([a, b], k) => {
    const L = [];
    for (let j = 0; j < b; j++) for (let i = 0; i < a; i++) L.push([2 * k + 2 * i, 2 * k + 2 * j, k]);
    return L;
  });
  // trim the excess from the top down (top tiles never support anything)
  const r = rng(info.lv * 7919 + 13);
  let excess = best.sum - T;
  for (let k = layers.length - 1; k >= 0 && excess > 0; k--) {
    shuffle(layers[k], r);
    const cut = Math.min(excess, layers[k].length);
    layers[k].splice(0, cut); excess -= cut;
  }
  return layers.flat();
}

// Face list for a level: `pairs` entries, deterministic per level
export function levelFaces(info) {
  const r = rng(info.lv * 104729 + 7);
  const pool = shuffle(FACES.slice(), r).slice(0, info.faces);
  const out = [];
  for (let i = 0; i < info.pairs; i++) out.push(pool[i % pool.length]);
  return out;
}

export function starsFor(info, timeLeft) {
  const ratio = timeLeft / info.timeLimit;
  return ratio >= 0.5 ? 3 : ratio >= 0.25 ? 2 : 1;
}

export function computeScore(info, timeLeft) {
  return Math.round((info.pairs * 10 + timeLeft * 3) * info.mult);
}

// ---- board rules (used by the battle page) ----
export function isFree(t, set) {
  let left = false, right = false;
  for (const o of set) {
    if (o === t || o.removed) continue;
    if (o.z === t.z + 1 && Math.abs(o.x - t.x) < 2 && Math.abs(o.y - t.y) < 2) return false;
    if (o.z === t.z && Math.abs(o.y - t.y) < 2) {
      if (o.x === t.x - 2) left = true;
      if (o.x === t.x + 2) right = true;
    }
  }
  return !(left && right);
}

// Remove random free pairs until empty -> the face assignment always has a solution.
export function assignSolvable(positions, facePairs, rand = Math.random) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const pool = positions.map(p => ({ x: p.x, y: p.y, z: p.z, removed: false, ref: p }));
    const pairs = shuffle(facePairs.slice(), rand);
    let ok = true;
    for (let i = 0; i < pairs.length; i++) {
      const free = pool.filter(p => !p.removed && isFree(p, pool));
      if (free.length < 2) { ok = false; break; }
      shuffle(free, rand);
      free[0].removed = free[1].removed = true;
      free[0].ref.face = free[1].ref.face = pairs[i];
    }
    if (ok) return true;
  }
  return false;
}
