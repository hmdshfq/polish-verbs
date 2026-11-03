// The site's Worker: dist/ as static assets, plus the one endpoint that keeps
// a learner's study state in D1 so it follows them between devices.
//
//   GET  /api/progress            → { code } with a fresh sync code
//   GET  /api/progress/:code      → { rev, data, updatedAt } or 404
//   PUT  /api/progress/:code      → body { data, baseRev } → { rev, updatedAt }
//                                   or 409 if someone else saved first
//
// Cloudflare serves a matching asset before this script runs, so a page view
// never costs an invocation; `run_worker_first` sends /api/* here and leaves
// everything else, a 404 included, to the asset server.
//
// The code is not a password, it is a private random key: whoever holds it can
// read and write that one record, and nothing else. It arrives in an x-sync-code
// header so it stays out of request logs and traces; the path segment still
// works for a link pasted into a browser. The revision is stamped
// here, never by the device, so two phones with wrong clocks cannot make an old
// save win: the caller sends the revision it read and the upsert only applies if
// that is still the stored one. The client keeps a copy on the device, so a
// missing or failing database never costs a learner their progress.
const MAX_BYTES = 512 * 1024;
const API = '/api/progress';

// A sync code is 12 characters from a 32-letter alphabet — Crockford's base32,
// which drops I, L, O and U so a code read aloud or copied by hand cannot be
// mistyped for another one. 12 × 5 bits is 60 bits of entropy, far beyond
// guessing, and 256 is a multiple of 32, so the modulo introduces no bias. The
// client shows it in three groups of four; the code itself has no spaces.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE = /^[0-9A-HJKMNP-TV-Z]{12}$/;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });

function newCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ALPHABET[b % 32]).join('');
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === API || pathname.startsWith(API + '/')) {
      return progress(request, env, pathname);
    }

    if (!env.ASSETS) return new Response("assets not configured", { status: 503 });
    return env.ASSETS.fetch(request);
  },
};

// Null when the URL names no code at all, '' when it names an empty one.
function pathCode(pathname) {
  if (pathname === API) return null;
  return pathname.slice(API.length).replace(/^\/+|\/+$/g, '');
}

async function progress(request, env, pathname) {
  // /api/progress/ is a bad request, not a request for a new code.
  const fromPath = pathCode(pathname);
  if (fromPath === '') return json({ error: 'a sync code is 12 letters and digits' }, 400);

  const given = request.headers.get('x-sync-code') || fromPath;
  const code = (given || '').toUpperCase();
  // Only a request that named no code at all is asking for a new one; a junk
  // code is a bad request, not a mint.
  const minting = request.method === 'GET' && !given;

  // Without a binding the site still works; the client falls back to the device.
  const db = env.DB;
  if (!db) {
    if (minting) return json({ code: null, enabled: false });
    return json({ enabled: false, error: 'progress sync is not configured' }, 503);
  }

  if (minting) {
    return json({ code: newCode(), enabled: true });
  }

  if (!CODE.test(code)) {
    return json({ error: 'a sync code is 12 letters and digits' }, 400);
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
      // Refuse an oversized body before reading it. A chunked upload declares
      // no length, so the same cap is checked again on what actually arrived.
      const declared = Number(request.headers.get('content-length') || 0);
      if (declared > MAX_BYTES) return json({ error: 'too much to save' }, 413);

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

      // Comparing and bumping inside the one upsert is what keeps two phones
      // from overwriting each other: with a null baseRev the comparison is a
      // no-op, so a caller that will not conflict can omit it.
      const base = Number.isInteger(body.baseRev) && body.baseRev >= 0 ? body.baseRev : null;
      const row = await db
        .prepare(
          `INSERT INTO progress (profile, rev, data, items, updated_at)
           VALUES (?, 1, ?, ?, ?)
           ON CONFLICT(profile) DO UPDATE SET
             rev = progress.rev + 1,
             data = excluded.data,
             items = excluded.items,
             updated_at = excluded.updated_at
           WHERE progress.rev = COALESCE(?, progress.rev)
           RETURNING rev, updated_at`
        )
        .bind(code, JSON.stringify(body.data), Object.keys(body.data.items || {}).length, new Date().toISOString(), base)
        .first();

      if (!row) return json({ error: 'someone else saved first' }, 409);
      return json({ rev: row.rev, updatedAt: row.updated_at });
    }

    return json({ error: 'method not allowed' }, 405, { allow: 'GET, PUT' });
  } catch (err) {
    console.error(
      JSON.stringify({ event: 'progress_failed', method: request.method, code, error: String(err) })
    );
    return json({ error: 'the database could not be reached' }, 500);
  }
}
