// Messenger API handlers — a faithful port of the standalone app/server.js
// endpoint logic to framework-free handlers (Pishmashool pattern): each
// handler takes (req, store) and returns { status, json, headers? } or, for
// file downloads, { status, headers, buffer }. The store interface is
// implemented by _db.js (Neon) in production and by test/memstore.mjs in the
// smoke test, so payloads and behaviour stay identical to the standalone app.
import crypto from 'node:crypto';
import { CONFIG } from './_config.js';

/* ---------------- passwords (same scrypt "salt:hash" format as standalone) ---------------- */
export function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return salt + ':' + hash;
}
export function checkPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === calc.length && crypto.timingSafeEqual(expected, calc);
}

/* ---------------- helpers ---------------- */
export function uuid() { return crypto.randomUUID(); }
export function publicUser(u) { return u ? { id: u.id, username: u.username } : null; }
export function chatKey(a, b) { return [a, b].sort().join('|'); }

function bodyOf(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return req.body;
}
function sessionToken(req) {
  const cookie = (req.headers && (req.headers.cookie || req.headers.Cookie)) || '';
  const m = cookie.match(/(?:^|;\s*)sid=([a-f0-9]+)/);
  return m ? m[1] : null;
}
async function authUser(req, store) {
  const token = sessionToken(req);
  if (!token) return null;
  const uid = await store.getSessionUserId(token);
  if (!uid) return null;
  return store.getUserById(uid);
}
const NOT_LOGGED_IN = { status: 401, json: { error: 'not_logged_in' } };

async function startSession(store, user, code) {
  const token = crypto.randomBytes(24).toString('hex');
  await store.createSession(token, user.id, Date.now());
  return {
    status: code,
    json: { user: publicUser(user) },
    headers: { 'Set-Cookie': 'sid=' + token + '; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000; Secure' },
  };
}
async function contactsList(store, userId) {
  const ids = await store.getContactIds(userId);
  const users = await store.getUsersByIds(ids);
  const byId = new Map(users.map((u) => [u.id, u]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map(publicUser);
}

/* ---------------- public endpoints ---------------- */
export async function handlePing(req, store) {
  return { status: 200, json: { ok: true, iranServerEnabled: !!CONFIG.IRAN_SERVER_ENABLED, ts: Date.now() } };
}

export async function handleConfig(req, store) {
  const iceServers = [{ urls: CONFIG.STUN_SERVERS && CONFIG.STUN_SERVERS.length ? CONFIG.STUN_SERVERS : ['stun:stun.l.google.com:19302'] }];
  for (const t of (CONFIG.TURN_SERVERS || [])) iceServers.push(t);
  return {
    status: 200,
    json: {
      iranServerEnabled: !!CONFIG.IRAN_SERVER_ENABLED,
      iranEndpoint: CONFIG.IRAN_ENDPOINT || '',
      iceServers,
    },
  };
}

export async function handleSignup(req, store) {
  if (req.method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  const { username, password } = bodyOf(req);
  const name = String(username || '').trim();
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(name)) return { status: 400, json: { error: 'username_3_24_chars' } };
  if (!password || String(password).length < 6) return { status: 400, json: { error: 'password_min_6' } };
  if (await store.getUserByName(name)) return { status: 409, json: { error: 'username_taken' } };
  const user = { id: uuid(), username: name, pass: hashPassword(String(password)), createdAt: Date.now() };
  await store.createUser(user);
  return startSession(store, user, 201);
}

export async function handleLogin(req, store) {
  if (req.method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  const { username, password } = bodyOf(req);
  const user = await store.getUserByName(username);
  if (!user || !checkPassword(String(password || ''), user.pass)) return { status: 401, json: { error: 'wrong_login' } };
  return startSession(store, user, 200);
}

export async function handleLogout(req, store) {
  if (req.method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  const token = sessionToken(req);
  if (token) await store.deleteSession(token);
  return { status: 200, json: { ok: true }, headers: { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' } };
}

/* Dual-server sync stub: guarded by the switch. While IRAN_SERVER_ENABLED is
   false this always reports disabled; no sync traffic happens. When Parsa
   later buys the Arvan server and flips the switch, the merge endpoint is
   implemented here (UUID + timestamp based, see README). */
export async function handleSync(req, store) {
  if (!CONFIG.IRAN_SERVER_ENABLED) return { status: 403, json: { enabled: false, error: 'iran_sync_disabled' } };
  if (!CONFIG.SYNC_SECRET || (req.headers && req.headers['x-sync-secret']) !== CONFIG.SYNC_SECRET) {
    return { status: 401, json: { enabled: true, error: 'bad_sync_secret' } };
  }
  return { status: 501, json: { enabled: true, error: 'sync_not_implemented_yet', messages: await store.countMessages() } };
}

/* ---------------- authenticated endpoints ---------------- */
export async function handleMe(req, store) {
  const me = await authUser(req, store);
  if (!me) return NOT_LOGGED_IN;
  return { status: 200, json: { user: publicUser(me) } };
}

export async function handleContacts(req, store) {
  const me = await authUser(req, store);
  if (!me) return NOT_LOGGED_IN;
  if (req.method === 'GET') {
    return { status: 200, json: { contacts: await contactsList(store, me.id) } };
  }
  if (req.method === 'POST') {
    const { username } = bodyOf(req);
    const other = await store.getUserByName(username);
    if (!other) return { status: 404, json: { error: 'user_not_found' } };
    if (other.id === me.id) return { status: 400, json: { error: 'cannot_add_self' } };
    // A 1-to-1 chat works both ways: add the reverse link too.
    await store.addContactPair(me.id, other.id);
    return { status: 200, json: { contact: publicUser(other) } };
  }
  return { status: 405, json: { error: 'method_not_allowed' } };
}

export async function handleMessages(req, store) {
  const me = await authUser(req, store);
  if (!me) return NOT_LOGGED_IN;
  if (req.method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  const b = bodyOf(req);
  const other = await store.getUserById(b.to);
  if (!other) return { status: 404, json: { error: 'recipient_not_found' } };
  const type = ['text', 'voice', 'photo', 'call'].includes(b.type) ? b.type : 'text';
  if (type === 'text' && !String(b.text || '').trim()) return { status: 400, json: { error: 'empty_text' } };
  // Offline-queue dedupe: the client generates the UUID and may retry the
  // same send after a network cut. Same UUID = same message, return existing.
  if (b.id) {
    const ex = await store.getMessageById(b.id);
    if (ex) return { status: 200, json: { message: ex, deduped: true } };
  }
  const seq = await store.nextSeq('msg');
  const msg = {
    id: b.id && /^[a-f0-9-]{36}$/i.test(b.id) ? b.id : uuid(),
    seq, updatedSeq: seq,
    chat: chatKey(me.id, other.id), from: me.id, to: other.id,
    type, text: type === 'text' ? String(b.text).slice(0, 4000) : '',
    media: b.media ? String(b.media).slice(0, 300) : null,
    callInfo: type === 'call' ? { kind: b.callInfo && b.callInfo.kind === 'video' ? 'video' : 'voice', outcome: b.callInfo && b.callInfo.outcome === 'ended' ? 'ended' : 'missed', durationSec: Math.max(0, parseInt(b.callInfo && b.callInfo.durationSec, 10) || 0) } : null,
    replyTo: b.replyTo ? { id: String(b.replyTo.id), from: String(b.replyTo.from || ''), text: String(b.replyTo.text || '').slice(0, 200), type: String(b.replyTo.type || 'text') } : null,
    edited: false, deleted: false, reaction: {},
    deliveredAt: null, seenAt: null,
    ts: typeof b.ts === 'number' ? b.ts : Date.now(),
  };
  await store.insertMessage(msg);
  return { status: 201, json: { message: msg } };
}

export async function handleMessageEdit(req, store) {
  const me = await authUser(req, store);
  if (!me) return NOT_LOGGED_IN;
  if (req.method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  const b = bodyOf(req);
  const msg = await store.getMessageById(b.id);
  if (!msg || msg.from !== me.id || msg.deleted) return { status: 404, json: { error: 'message_not_found' } };
  const updated = await store.patchMessage(msg.id, {
    text: String(b.text || '').slice(0, 4000), edited: true, updatedSeq: await store.nextSeq('msg'),
  });
  return { status: 200, json: { message: updated } };
}

export async function handleMessageDelete(req, store) {
  const me = await authUser(req, store);
  if (!me) return NOT_LOGGED_IN;
  if (req.method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  const b = bodyOf(req);
  const msg = await store.getMessageById(b.id);
  if (!msg || msg.from !== me.id) return { status: 404, json: { error: 'message_not_found' } };
  const updated = await store.patchMessage(msg.id, {
    deleted: true, text: '', media: null, updatedSeq: await store.nextSeq('msg'),
  });
  return { status: 200, json: { message: updated } };
}

export async function handleMessageReact(req, store) {
  const me = await authUser(req, store);
  if (!me) return NOT_LOGGED_IN;
  if (req.method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  const b = bodyOf(req);
  const msg = await store.getMessageById(b.id);
  if (!msg || (msg.from !== me.id && msg.to !== me.id)) return { status: 404, json: { error: 'message_not_found' } };
  const reaction = Object.assign({}, msg.reaction);
  if (b.emoji) reaction[me.id] = String(b.emoji).slice(0, 8); else delete reaction[me.id];
  const updated = await store.patchMessage(msg.id, { reaction, updatedSeq: await store.nextSeq('msg') });
  return { status: 200, json: { message: updated } };
}

export async function handleSeen(req, store) {
  const me = await authUser(req, store);
  if (!me) return NOT_LOGGED_IN;
  if (req.method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  const b = bodyOf(req);
  const now = Date.now();
  const mine = await store.listMessagesForUser(me.id);
  for (const m of mine) {
    if (m.from === b.with && m.to === me.id && !m.seenAt) {
      await store.patchMessage(m.id, {
        seenAt: now, deliveredAt: m.deliveredAt || now, updatedSeq: await store.nextSeq('msg'),
      });
    }
  }
  return { status: 200, json: { ok: true } };
}

export async function handleTyping(req, store) {
  const me = await authUser(req, store);
  if (!me) return NOT_LOGGED_IN;
  if (req.method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  const b = bodyOf(req);
  if (b.typing) await store.setTyping(me.id, b.to, Date.now() + 4000);
  else await store.clearTyping(me.id, b.to);
  return { status: 200, json: { ok: true } };
}

/* ---------------- uploads ---------------- */
const UPLOAD_MIME = { png: 'image/png', jpg: 'image/jpeg', webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4' };

export async function handleUpload(req, store) {
  const me = await authUser(req, store);
  if (!me) return NOT_LOGGED_IN;
  if (req.method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  const b = bodyOf(req);
  const kind = b.kind === 'photo' ? 'photo' : 'voice';
  const mime = String(b.mime || '');
  const ext = kind === 'photo' ? (mime.includes('png') ? 'png' : 'jpg') : (mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm');
  const data = Buffer.from(String(b.data || ''), 'base64');
  if (!data.length || data.length > 9 * 1024 * 1024) return { status: 400, json: { error: 'bad_or_too_big_file' } };
  const name = uuid() + '.' + ext;
  await store.saveUpload(name, UPLOAD_MIME[ext] || 'application/octet-stream', data.toString('base64'));
  return { status: 201, json: { url: '/uploads/' + name } };
}

// Serves an uploaded file with HTTP Range support (voice-message seeking),
// exactly like the standalone static file server. Routed via the vercel.json
// rewrite /uploads/:name -> /api/uploads/:name.
export async function handleUploadFile(req, store) {
  const raw = String((req.query && req.query.name) || '');
  const name = raw.split('/').pop();
  const up = name ? await store.getUpload(name) : null;
  if (!up) return { status: 404, json: { error: 'not_found' } };
  const buf = Buffer.from(String(up.data || ''), 'base64');
  const type = up.mime || 'application/octet-stream';
  const range = req.headers && req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : buf.length - 1;
      return {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Range': 'bytes ' + start + '-' + end + '/' + buf.length,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
        },
        buffer: buf.subarray(start, end + 1),
      };
    }
  }
  return {
    status: 200,
    headers: { 'Content-Type': type, 'Content-Length': buf.length, 'Accept-Ranges': 'bytes' },
    buffer: buf,
  };
}

/* ---------------- WebRTC signaling relay ----------------
   offer / answer / ICE / end are queued per user and delivered through the
   poll below. No media passes through this server. */
export async function handleSignal(req, store) {
  const me = await authUser(req, store);
  if (!me) return NOT_LOGGED_IN;
  if (req.method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  const b = bodyOf(req);
  const other = await store.getUserById(b.to);
  if (!other) return { status: 404, json: { error: 'recipient_not_found' } };
  if (!['offer', 'answer', 'ice', 'end', 'decline', 'busy'].includes(b.kind)) return { status: 400, json: { error: 'bad_kind' } };
  const sig = {
    sseq: await store.nextSeq('sig'),
    from: me.id, to: other.id,
    kind: b.kind, payload: b.payload || null,
    callId: String(b.callId || ''), media: b.media === 'video' ? 'video' : 'voice',
    ts: Date.now(),
  };
  await store.saveSignal(sig);
  return { status: 201, json: { ok: true, sseq: sig.sseq } };
}

export async function handlePoll(req, store) {
  const me = await authUser(req, store);
  if (!me) return NOT_LOGGED_IN;
  if (req.method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
  const query = req.query || {};
  const sinceSeq = parseInt(query.seq, 10) || 0;
  const sinceSig = parseInt(query.sig, 10) || 0;
  const now = Date.now();
  const all = await store.listMessagesForUser(me.id);
  const msgs = [];
  for (let m of all) {
    // The recipient polling = the message reached their device: delivered.
    if (m.to === me.id && !m.deliveredAt && m.seq > sinceSeq) {
      m = await store.patchMessage(m.id, { deliveredAt: now, updatedSeq: await store.nextSeq('msg') });
    }
    if (m.seq > sinceSeq || m.updatedSeq > sinceSeq) msgs.push(m);
  }
  const sigs = (await store.listSignalsFor(me.id, sinceSig)).map((s) => ({
    sseq: s.sseq, from: s.from, kind: s.kind, payload: s.payload, callId: s.callId, media: s.media, ts: s.ts,
  }));
  if (sigs.length) await store.deleteDeliveredSignals(me.id, sinceSig, now - 60000);
  const typingOut = {};
  for (const fromId of await store.getTypingFrom(me.id, now)) typingOut[fromId] = true;
  const contacts = await contactsList(store, me.id);
  return {
    status: 200,
    json: {
      messages: msgs, signals: sigs, typing: typingOut, contacts,
      seq: await store.currentSeq('msg'), sigSeq: await store.currentSeq('sig'), serverTs: now,
    },
  };
}

/* ---------------- Vercel adapter (mirrors Pishmashool's adapt) ---------------- */
export function adapt(handler, makeStore) {
  return async (req, res) => {
    try {
      const store = makeStore();
      await store.ensureInit();
      const out = await handler(req, store);
      if (out.headers) for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
      res.status(out.status);
      if (out.buffer !== undefined) {
        res.send(out.buffer);
      } else {
        res.json(out.json || { ok: true });
      }
    } catch (e) {
      console.error('messenger api error:', e);
      res.status(500).json({ error: 'server_error' });
    }
  };
}
