// API router — the whole messenger API is served by ONE Vercel Serverless
// Function (the Hobby plan allows at most 12 functions per deployment, and
// this API has 18 endpoints). api/[...slug].js is the only function file;
// it delegates here.
//
// Routing is by exact request path to the same handlers the per-endpoint
// function files used before (the handlers live in api/_lib.js and are
// named by the endpoint modules in api/_handlers/), wrapped in the same
// adapt() contract — so endpoint paths, payloads, status codes and
// behaviour are unchanged. Method checks stay inside the handlers, exactly
// as when each endpoint was its own function.
import { adapt } from './_lib.js';
import ping from './_handlers/ping.js';
import config from './_handlers/config.js';
import signup from './_handlers/signup.js';
import login from './_handlers/login.js';
import logout from './_handlers/logout.js';
import sync from './_handlers/sync.js';
import me from './_handlers/me.js';
import contacts from './_handlers/contacts.js';
import messages from './_handlers/messages.js';
import messageEdit from './_handlers/messages/edit.js';
import messageDelete from './_handlers/messages/delete.js';
import messageReact from './_handlers/messages/react.js';
import seen from './_handlers/seen.js';
import typing from './_handlers/typing.js';
import upload from './_handlers/upload.js';
import uploadFile from './_handlers/uploads/name.js';
import signal from './_handlers/signal.js';
import poll from './_handlers/poll.js';

const ROUTES = new Map([
  ['/api/ping', ping],
  ['/api/config', config],
  ['/api/signup', signup],
  ['/api/login', login],
  ['/api/logout', logout],
  ['/api/sync', sync],
  ['/api/me', me],
  ['/api/contacts', contacts],
  ['/api/messages', messages],
  ['/api/messages/edit', messageEdit],
  ['/api/messages/delete', messageDelete],
  ['/api/messages/react', messageReact],
  ['/api/seen', seen],
  ['/api/typing', typing],
  ['/api/upload', upload],
  ['/api/signal', signal],
  ['/api/poll', poll],
]);

// Resolve the request path the way Vercel presents it to a catch-all
// function: req.query.slug holds the path segments after /api/, and
// req.url holds the (possibly rewritten) path. Prefer slug; fall back
// to parsing the URL (the smoke test drives this router with both set,
// mirroring the live function).
function requestPath(req) {
  const slug = req.query && req.query.slug;
  if (slug !== undefined && slug !== null && slug !== '') {
    const parts = (Array.isArray(slug) ? slug : [slug]).map((s) => {
      try { return decodeURIComponent(String(s)); } catch (e) { return String(s); }
    });
    return '/api/' + parts.join('/');
  }
  try {
    return new URL(req.url || '', 'http://localhost').pathname;
  } catch (e) {
    return String(req.url || '').split('?')[0];
  }
}

export function resolveHandler(req) {
  let pathname = requestPath(req);
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  // Uploaded files: /api/uploads/<name>. The vercel.json rewrite maps the
  // public /uploads/<name> onto this path, so it lands in the catch-all.
  // handleUploadFile reads req.query.name — set it here, exactly as the
  // old api/uploads/[name].js function received it from Vercel.
  const up = /^\/api\/uploads\/(.+)$/.exec(pathname);
  if (up) {
    let name = up[1];
    try { name = decodeURIComponent(name); } catch (e) { /* keep raw */ }
    req.query = Object.assign({}, req.query, { name });
    return uploadFile;
  }
  return ROUTES.get(pathname) || null;
}

// makeStore is injected so production passes _db.js's createStore while
// the smoke test passes the in-memory store factory — the routing and
// adapt() wrapping are identical either way.
export function createApiHandler(makeStore) {
  return async (req, res) => {
    const handler = resolveHandler(req);
    if (!handler) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    return adapt(handler, makeStore)(req, res);
  };
}
