import { MAX_LEVEL, FACES, levelInfo, computeScore, starsFor } from '../public/levels.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

function cleanName(raw) {
  const name = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 12);
  return name.length ? name : null;
}

async function getPlayer(env, token) {
  if (!token || !UUID.test(token)) return null;
  return env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(token).first();
}

async function rankOf(env, p) {
  const r = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM players WHERE max_level > ?1 OR (max_level = ?1 AND total_score > ?2)'
  ).bind(p.max_level, p.total_score).first();
  return (r?.n ?? 0) + 1;
}

async function profile(env, p) {
  const { results } = await env.DB.prepare(
    'SELECT level, best_score, best_stars FROM level_scores WHERE player_id = ?'
  ).bind(p.id).all();
  const levels = {};
  for (const r of results) levels[r.level] = { score: r.best_score, stars: r.best_stars };
  return {
    name: p.name, maxLevel: p.max_level, totalScore: p.total_score,
    totalStars: p.total_stars, rank: await rankOf(env, p), levels,
  };
}

async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

async function api(req, env, url) {
  const path = url.pathname;
  const now = Date.now();

  if (path === '/api/register' && req.method === 'POST') {
    const { name } = await body(req);
    const n = cleanName(name);
    if (!n) return json({ error: '닉네임을 입력해 주세요' }, 400);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO players (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).bind(id, n, now, now).run();
    const p = await getPlayer(env, id);
    return json({ token: id, ...(await profile(env, p)) });
  }

  if (path === '/api/me' && req.method === 'GET') {
    const p = await getPlayer(env, url.searchParams.get('token'));
    if (!p) return json({ error: 'not_found' }, 404);
    return json(await profile(env, p));
  }

  if (path === '/api/rename' && req.method === 'POST') {
    const { token, name } = await body(req);
    const p = await getPlayer(env, token);
    if (!p) return json({ error: 'not_found' }, 404);
    const n = cleanName(name);
    if (!n) return json({ error: '닉네임을 입력해 주세요' }, 400);
    await env.DB.prepare('UPDATE players SET name = ?, updated_at = ? WHERE id = ?').bind(n, now, p.id).run();
    return json({ ok: true, name: n });
  }

  if (path === '/api/clear' && req.method === 'POST') {
    const { token, level, timeLeft } = await body(req);
    const p = await getPlayer(env, token);
    if (!p) return json({ error: 'not_found' }, 404);
    const lv = Number(level), tl = Math.floor(Number(timeLeft));
    if (!Number.isInteger(lv) || lv < 1 || lv > MAX_LEVEL) return json({ error: 'bad_level' }, 400);
    if (lv > p.max_level + 1) return json({ error: 'locked' }, 403);
    const info = levelInfo(lv);
    const minElapsed = Math.ceil(info.pairs * 0.4); // nobody clears faster than this
    if (!Number.isFinite(tl) || tl < 0 || tl > info.timeLimit - minElapsed) return json({ error: 'bad_time' }, 400);

    const score = computeScore(info, tl);
    const stars = starsFor(info, tl);
    const prev = await env.DB.prepare(
      'SELECT best_score, best_stars FROM level_scores WHERE player_id = ? AND level = ?'
    ).bind(p.id, lv).first();

    const newBest = !prev || score > prev.best_score;
    const scoreDelta = prev ? Math.max(0, score - prev.best_score) : score;
    const starDelta = prev ? Math.max(0, stars - prev.best_stars) : stars;

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO level_scores (player_id, level, best_score, best_stars, best_time_left, clears, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)
        ON CONFLICT (player_id, level) DO UPDATE SET
          best_score = MAX(best_score, excluded.best_score),
          best_stars = MAX(best_stars, excluded.best_stars),
          best_time_left = MAX(best_time_left, excluded.best_time_left),
          clears = clears + 1,
          updated_at = excluded.updated_at`
      ).bind(p.id, lv, score, stars, tl, now),
      env.DB.prepare(`
        UPDATE players SET
          max_level = MAX(max_level, ?2),
          total_score = total_score + ?3,
          total_stars = total_stars + ?4,
          updated_at = ?5
        WHERE id = ?1`
      ).bind(p.id, lv, scoreDelta, starDelta, now),
    ]);
    const updated = await getPlayer(env, p.id);
    return json({
      score, stars, newBest,
      best: Math.max(score, prev?.best_score ?? 0),
      maxLevel: updated.max_level, totalScore: updated.total_score,
      totalStars: updated.total_stars, rank: await rankOf(env, updated),
    });
  }

  if (path === '/api/ranking' && req.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT name, max_level, total_score, total_stars FROM players WHERE max_level > 0 ORDER BY max_level DESC, total_score DESC, updated_at ASC LIMIT 100'
    ).all();
    let me = null;
    const p = await getPlayer(env, url.searchParams.get('token'));
    if (p) me = { name: p.name, maxLevel: p.max_level, totalScore: p.total_score, totalStars: p.total_stars, rank: await rankOf(env, p) };
    return json({
      top: results.map((r, i) => ({ rank: i + 1, name: r.name, maxLevel: r.max_level, totalScore: r.total_score, totalStars: r.total_stars })),
      me,
    });
  }

  if (path === '/api/ai-move' && req.method === 'POST') return aiMove(req, env);

  return json({ error: 'not_found' }, 404);
}

// ---------------- AI opponent (OpenRouter) ----------------
const AI_MODEL = 'openai/gpt-4o';
const FACE_SET = new Set(FACES);

async function aiMove(req, env) {
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  if (env.AI_LIMIT) {
    const { success } = await env.AI_LIMIT.limit({ key: ip });
    if (!success) return json({ error: 'rate_limited' }, 429);
  }
  const { tiles, count: rawCount } = await body(req);
  const count = Math.max(1, Math.min(5, Number(rawCount) | 0 || 1)); // pairs wanted per call
  if (!Array.isArray(tiles) || tiles.length < 2 || tiles.length > 200) return json({ error: 'bad_board' }, 400);
  const clean = [];
  for (const t of tiles) {
    if (!Number.isInteger(t?.id) || t.id < 0 || t.id > 500 || !FACE_SET.has(t?.f)) return json({ error: 'bad_board' }, 400);
    clean.push({ id: t.id, f: t.f });
  }

  // Local testing without a key: pick a matching pair on the server.
  if (env.AI_MOCK === '1') {
    await new Promise(r => setTimeout(r, 600));
    const used = new Set(), pairs = [];
    for (let i = 0; i < clean.length && pairs.length < count; i++) for (let j = i + 1; j < clean.length; j++)
      if (!used.has(i) && !used.has(j) && clean[i].f === clean[j].f) { pairs.push([clean[i].id, clean[j].id]); used.add(i); used.add(j); break; }
    if (!pairs.length) pairs.push([clean[0].id, clean[1].id]);
    return json({ pairs, a: pairs[0][0], b: pairs[0][1], say: '찾았다! 🤖' });
  }

  if (!env.OPENROUTER_API_KEY) return json({ error: 'no_key' }, 503);

  const list = clean.map(t => `${t.id}:${t.f}`).join(' ');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'X-Title': 'Mallang Mahjong',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0.4,
      max_tokens: 40 + count * 20,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a cute, playful robot racing a human in a mahjong tile-matching game. ' +
            'You get the currently selectable tiles as "id:emoji". ' +
            `Find up to ${count} pairs. Each pair is two DIFFERENT ids showing the SAME emoji; never reuse an id. ` +
            'Reply ONLY with JSON: {"pairs":[[<id>,<id>],...],"say":"<very short Korean trash talk or cheer, max 15 chars>"}',
        },
        { role: 'user', content: `Selectable tiles: ${list}` },
      ],
    }),
  });
  if (!res.ok) {
    console.error('openrouter', res.status, await res.text().catch(() => ''));
    return json({ error: 'ai_failed', status: res.status }, 502);
  }
  const data = await res.json();
  let move = {};
  try { move = JSON.parse(data.choices?.[0]?.message?.content || '{}'); } catch {}
  let pairs = Array.isArray(move.pairs) ? move.pairs : [[move.a, move.b]];
  pairs = pairs.filter(p => Array.isArray(p) && p.length === 2).slice(0, count).map(([a, b]) => [Number(a), Number(b)]);
  if (!pairs.length) pairs = [[NaN, NaN]];
  const say = typeof move.say === 'string' ? move.say.replace(/[<>]/g, '').slice(0, 20) : '';
  return json({ pairs, a: pairs[0][0], b: pairs[0][1], say });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await api(req, env, url); }
      catch (e) { console.error(e); return json({ error: 'server_error' }, 500); }
    }
    return env.ASSETS.fetch(req);
  },
};
