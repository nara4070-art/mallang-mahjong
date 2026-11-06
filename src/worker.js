import { MAX_LEVEL, levelInfo, computeScore, starsFor } from '../public/levels.js';

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

  return json({ error: 'not_found' }, 404);
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
