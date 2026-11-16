// Storage layer for the Vercel variant — Neon Postgres via @neondatabase/serverless.
//
// Every handler in _lib.js talks ONLY to the store interface implemented here
// (domain-level shapes: messages in exact client shape, users as
// {id, username, pass, createdAt}). The smoke test swaps this module for an
// in-memory store with the identical interface (test/memstore.mjs), so the
// handler logic is fully testable without a database.
//
// Schema creation is idempotent (CREATE TABLE IF NOT EXISTS) and runs lazily
// on the first request of a cold instance, mirroring Pishmashool's ensureInit.
import { neon } from '@neondatabase/serverless';

let sqlSingleton = null;
function sql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!sqlSingleton) sqlSingleton = neon(process.env.DATABASE_URL);
  return sqlSingleton;
}
function q(text, params) {
  return sql()(text, params || []);
}

/* ---------- row -> domain mappers ---------- */
function rowToUser(r) {
  return r ? { id: r.id, username: r.username, pass: r.pass, createdAt: r.created_at == null ? null : Number(r.created_at) } : null;
}
function rowToMessage(r) {
  if (!r) return null;
  return {
    id: r.id,
    seq: Number(r.seq),
    updatedSeq: Number(r.updated_seq),
    chat: r.chat,
    from: r.from_id,
    to: r.to_id,
    type: r.type,
    text: r.text == null ? '' : r.text,
    media: r.media == null ? null : r.media,
    callInfo: r.call_info == null ? null : r.call_info,
    replyTo: r.reply_to == null ? null : r.reply_to,
    edited: !!r.edited,
    deleted: !!r.deleted,
    reaction: r.reaction || {},
    deliveredAt: r.delivered_at == null ? null : Number(r.delivered_at),
    seenAt: r.seen_at == null ? null : Number(r.seen_at),
    ts: Number(r.ts),
  };
}
function rowToSignal(r) {
  if (!r) return null;
  return {
    sseq: Number(r.sseq),
    from: r.from_id,
    to: r.to_id,
    kind: r.kind,
    payload: r.payload == null ? null : r.payload,
    callId: r.call_id || '',
    media: r.media || 'voice',
    ts: Number(r.ts),
  };
}

/* ---------- schema (idempotent, lazy) ---------- */
let initPromise = null;
function ensureInit() {
  if (!initPromise) {
    initPromise = doInit().catch((e) => { initPromise = null; throw e; });
  }
  return initPromise;
}
async function doInit() {
  await q(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    pass TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`);
  await q('CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username))');
  await q(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`);
  await q(`CREATE TABLE IF NOT EXISTS contacts (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    UNIQUE (user_id, contact_id)
  )`);
  await q(`CREATE TABLE IF NOT EXISTS counters (
    name TEXT PRIMARY KEY,
    value BIGINT NOT NULL
  )`);
  await q(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    seq BIGINT NOT NULL,
    updated_seq BIGINT NOT NULL,
    chat TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    type TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    media TEXT,
    call_info JSONB,
    reply_to JSONB,
    edited BOOLEAN NOT NULL DEFAULT false,
    deleted BOOLEAN NOT NULL DEFAULT false,
    reaction JSONB NOT NULL DEFAULT '{}'::jsonb,
    delivered_at DOUBLE PRECISION,
    seen_at DOUBLE PRECISION,
    ts DOUBLE PRECISION NOT NULL
  )`);
  await q('CREATE INDEX IF NOT EXISTS messages_seq_idx ON messages (seq)');
  await q('CREATE INDEX IF NOT EXISTS messages_pair_idx ON messages (from_id, to_id)');
  await q(`CREATE TABLE IF NOT EXISTS signals (
    sseq BIGINT PRIMARY KEY,
    to_id TEXT NOT NULL,
    from_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload JSONB,
    call_id TEXT,
    media TEXT,
    ts DOUBLE PRECISION NOT NULL
  )`);
  await q(`CREATE TABLE IF NOT EXISTS typing (
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    expires_at DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (from_id, to_id)
  )`);
  await q(`CREATE TABLE IF NOT EXISTS uploads (
    name TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    data TEXT NOT NULL
  )`);
}

/* ---------- store ---------- */
const PATCH_COLUMNS = {
  text: 'text', edited: 'edited', deleted: 'deleted', media: 'media',
  reaction: 'reaction', updatedSeq: 'updated_seq', deliveredAt: 'delivered_at', seenAt: 'seen_at',
};
const JSON_PATCH_KEYS = new Set(['reaction']);

export function createStore() {
  return {
    ensureInit,

    /* users */
    async getUserByName(name) {
      const rows = await q('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [String(name || '')]);
      return rowToUser(rows[0]);
    },
    async getUserById(id) {
      const rows = await q('SELECT * FROM users WHERE id = $1', [id]);
      return rowToUser(rows[0]);
    },
    async getUsersByIds(ids) {
      if (!ids || !ids.length) return [];
      const rows = await q('SELECT * FROM users WHERE id = ANY($1)', [ids]);
      return rows.map(rowToUser);
    },
    async createUser(user) {
      await q('INSERT INTO users (id, username, pass, created_at) VALUES ($1,$2,$3,$4)',
        [user.id, user.username, user.pass, user.createdAt]);
    },

    /* sessions */
    async createSession(token, userId, createdAt) {
      await q('INSERT INTO sessions (token, user_id, created_at) VALUES ($1,$2,$3) ON CONFLICT (token) DO NOTHING',
        [token, userId, createdAt]);
    },
    async getSessionUserId(token) {
      const rows = await q('SELECT user_id FROM sessions WHERE token = $1', [token]);
      return rows.length ? rows[0].user_id : null;
    },
    async deleteSession(token) {
      await q('DELETE FROM sessions WHERE token = $1', [token]);
    },

    /* contacts */
    async getContactIds(userId) {
      const rows = await q('SELECT contact_id FROM contacts WHERE user_id = $1 ORDER BY id ASC', [userId]);
      return rows.map((r) => r.contact_id);
    },
    async addContactPair(aId, bId) {
      await q('INSERT INTO contacts (user_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [aId, bId]);
      await q('INSERT INTO contacts (user_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [bId, aId]);
    },

    /* sequence counters (message seq / updatedSeq and signal sseq) */
    async nextSeq(name) {
      const rows = await q(
        `INSERT INTO counters (name, value) VALUES ($1, 1)
         ON CONFLICT (name) DO UPDATE SET value = counters.value + 1
         RETURNING value`,
        [name]
      );
      return Number(rows[0].value);
    },
    async currentSeq(name) {
      const rows = await q('SELECT value FROM counters WHERE name = $1', [name]);
      return rows.length ? Number(rows[0].value) : 0;
    },

    /* messages */
    async insertMessage(m) {
      await q(
        `INSERT INTO messages (id, seq, updated_seq, chat, from_id, to_id, type, text, media, call_info, reply_to, edited, deleted, reaction, delivered_at, seen_at, ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [m.id, m.seq, m.updatedSeq, m.chat, m.from, m.to, m.type, m.text, m.media,
         m.callInfo ? JSON.stringify(m.callInfo) : null,
         m.replyTo ? JSON.stringify(m.replyTo) : null,
         !!m.edited, !!m.deleted, JSON.stringify(m.reaction || {}),
         m.deliveredAt, m.seenAt, m.ts]
      );
    },
    async getMessageById(id) {
      const rows = await q('SELECT * FROM messages WHERE id = $1', [id]);
      return rowToMessage(rows[0]);
    },
    async patchMessage(id, patch) {
      const sets = [];
      const params = [];
      for (const [key, value] of Object.entries(patch)) {
        const col = PATCH_COLUMNS[key];
        if (!col) continue;
        params.push(JSON_PATCH_KEYS.has(key) ? JSON.stringify(value || {}) : value);
        sets.push(col + ' = $' + params.length);
      }
      if (!sets.length) return this.getMessageById(id);
      params.push(id);
      const rows = await q('UPDATE messages SET ' + sets.join(', ') + ' WHERE id = $' + params.length + ' RETURNING *', params);
      return rowToMessage(rows[0]);
    },
    async listMessagesForUser(userId) {
      const rows = await q('SELECT * FROM messages WHERE from_id = $1 OR to_id = $1 ORDER BY seq ASC', [userId]);
      return rows.map(rowToMessage);
    },
    async countMessages() {
      const rows = await q('SELECT COUNT(*)::int AS c FROM messages');
      return rows[0].c;
    },

    /* WebRTC signaling relay (queued per user, delivered through the poll) */
    async saveSignal(sig) {
      await q(
        'INSERT INTO signals (sseq, to_id, from_id, kind, payload, call_id, media, ts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [sig.sseq, sig.to, sig.from, sig.kind, sig.payload ? JSON.stringify(sig.payload) : null, sig.callId, sig.media, sig.ts]
      );
    },
    async listSignalsFor(userId, sinceSseq) {
      const rows = await q('SELECT * FROM signals WHERE to_id = $1 AND sseq > $2 ORDER BY sseq ASC', [userId, sinceSseq]);
      return rows.map(rowToSignal);
    },
    // Mirrors the standalone in-memory inbox cleanup: once a signal has been
    // delivered (sseq <= the client's cursor) and is over 60s old, drop it.
    async deleteDeliveredSignals(userId, upToSseq, cutoffTs) {
      await q('DELETE FROM signals WHERE to_id = $1 AND sseq <= $2 AND ts < $3', [userId, upToSseq, cutoffTs]);
    },

    /* typing indicators */
    async setTyping(fromId, toId, expiresAt) {
      await q(
        `INSERT INTO typing (from_id, to_id, expires_at) VALUES ($1,$2,$3)
         ON CONFLICT (from_id, to_id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
        [fromId, toId, expiresAt]
      );
    },
    async clearTyping(fromId, toId) {
      await q('DELETE FROM typing WHERE from_id = $1 AND to_id = $2', [fromId, toId]);
    },
    async getTypingFrom(userId, now) {
      const rows = await q('SELECT from_id FROM typing WHERE to_id = $1 AND expires_at > $2', [userId, now]);
      return rows.map((r) => r.from_id);
    },

    /* uploads (base64 payloads in a table; personal scale) */
    async saveUpload(name, mime, dataB64) {
      await q('INSERT INTO uploads (name, mime, data) VALUES ($1,$2,$3) ON CONFLICT (name) DO NOTHING', [name, mime, dataB64]);
    },
    async getUpload(name) {
      const rows = await q('SELECT mime, data FROM uploads WHERE name = $1', [name]);
      return rows.length ? rows[0] : null;
    },
  };
}
