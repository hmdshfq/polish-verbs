// The site's Worker: dist/ as static assets, plus the one endpoint that keeps
// a learner's study state in D1 so it follows them between devices.
//
//   GET  /api/progress            → { code } with a fresh sync code
//   GET  /api/progress/:code      → { rev, data, updatedAt } or 404
//   PUT  /api/progress/:code      → body { data, rev } → { rev, updatedAt }
//
// Cloudflare serves a matching asset before this script runs, so a page view
// never costs an invocation. A path that matches no asset lands here and falls
// through to ASSETS, which answers 404 — the site has no 404 page of its own.
//
// The code is not a password, it is a private random key: whoever holds it can
// read and write that one record, and nothing else. The revision is stamped
// here rather than by the device, so two phones with wrong clocks cannot make
// an old save win. The client keeps a copy on the device, so a missing or
// failing database never costs a learner their progress.
const MAX_BYTES = 512 * 1024;
const CODE = /^[a-f0-9]{32}$/;
const API = '/api/progress';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

function newCode() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === API || pathname.startsWith(API + '/')) {
      const code = pathname.slice(API.length).replace(/^\/+|\/+$/g, '');
      return progress(request, env, code);
    }

    return env.ASSETS.fetch(request);
  },
};

async function progress(request, env, code) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  // Without a binding the site still works; the client falls back to the device.
  const db = env.DB;
  if (!db) {
    if (request.method === 'GET' && !code) return json({ code: null, enabled: false });
    return json({ enabled: false, error: 'progress sync is not configured' }, 503);
  }

  if (request.method === 'GET' && !code) {
    return json({ code: newCode(), enabled: true });
  }

  if (!CODE.test(code)) {
    return json({ error: 'a sync code is 32 hex characters' }, 400);
  }

  try {
    if (request.method === 'GET') {
      const row = await db
        .prepare('SELECT rev, data, updated_at FROM progress WHERE profile = ?')
        .bind(code)
        .first();
      if (!row) return json({ error: 'no progress saved under that code' }, 404);
      return json({ rev: row.rev, data: JSON.parse(row.data), updatedAt: row.updated_at });
    }

    if (request.method === 'PUT') {
      const raw = await request.text();
      if (raw.length > MAX_BYTES) return json({ error: 'too much to save' }, 413);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return json({ error: 'body must be JSON' }, 400);
      }
      if (!body || typeof body.data !== 'object' || body.data === null) {
        return json({ error: 'missing data' }, 400);
      }
      const data = JSON.stringify(body.data);
      const items = Object.keys(body.data.items || {}).length;
      const now = new Date().toISOString();

      // The server owns the revision: it always increases, and the response
      // tells the client which revision its save became.
      const existing = await db
        .prepare('SELECT rev FROM progress WHERE profile = ?')
        .bind(code)
        .first();
      const rev = (existing ? existing.rev : 0) + 1;

      await db
        .prepare(
          `INSERT INTO progress (profile, rev, data, items, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(profile) DO UPDATE SET
             rev = excluded.rev,
             data = excluded.data,
             items = excluded.items,
             updated_at = excluded.updated_at`
        )
        .bind(code, rev, data, items, now)
        .run();

      return json({ rev, updatedAt: now });
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (err) {
    return json({ error: 'the database could not be reached', detail: String(err) }, 500);
  }
}
