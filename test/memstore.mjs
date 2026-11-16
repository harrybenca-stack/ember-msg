// In-memory implementation of the exact store interface that api/_db.js
// (Neon) implements in production. Used only by test/smoke.mjs so the handler
// logic in api/_lib.js can be verified without a database.
export function createMemoryStore() {
  const users = [];
  const sessions = new Map(); // token -> userId
  const contacts = []; // {user_id, contact_id} in insertion order
  const counters = new Map(); // name -> value
  const messages = [];
  const signals = [];
  const typing = new Map(); // "from>to" -> expiresAt
  const uploads = new Map(); // name -> {mime, data}

  return {
    async ensureInit() {},

    async getUserByName(name) {
      return users.find((u) => u.username.toLowerCase() === String(name || '').toLowerCase()) || null;
    },
    async getUserById(id) {
      return users.find((u) => u.id === id) || null;
    },
    async getUsersByIds(ids) {
      return users.filter((u) => ids.includes(u.id));
    },
    async createUser(user) { users.push(user); },

    async createSession(token, userId) { sessions.set(token, userId); },
    async getSessionUserId(token) { return sessions.get(token) || null; },
    async deleteSession(token) { sessions.delete(token); },

    async getContactIds(userId) {
      return contacts.filter((c) => c.user_id === userId).map((c) => c.contact_id);
    },
    async addContactPair(aId, bId) {
      if (!contacts.some((c) => c.user_id === aId && c.contact_id === bId)) contacts.push({ user_id: aId, contact_id: bId });
      if (!contacts.some((c) => c.user_id === bId && c.contact_id === aId)) contacts.push({ user_id: bId, contact_id: aId });
    },

    async nextSeq(name) {
      const v = (counters.get(name) || 0) + 1;
      counters.set(name, v);
      return v;
    },
    async currentSeq(name) { return counters.get(name) || 0; },

    async insertMessage(m) { messages.push(m); },
    async getMessageById(id) { return messages.find((m) => m.id === id) || null; },
    async patchMessage(id, patch) {
      const m = messages.find((x) => x.id === id);
      if (!m) return null;
      Object.assign(m, patch);
      return m;
    },
    async listMessagesForUser(userId) {
      return messages.filter((m) => m.from === userId || m.to === userId).slice().sort((a, b) => a.seq - b.seq);
    },
    async countMessages() { return messages.length; },

    async saveSignal(sig) { signals.push(sig); },
    async listSignalsFor(userId, sinceSseq) {
      return signals.filter((s) => s.to === userId && s.sseq > sinceSseq).slice().sort((a, b) => a.sseq - b.sseq);
    },
    async deleteDeliveredSignals(userId, upToSseq, cutoffTs) {
      for (let i = signals.length - 1; i >= 0; i--) {
        const s = signals[i];
        if (s.to === userId && s.sseq <= upToSseq && s.ts < cutoffTs) signals.splice(i, 1);
      }
    },

    async setTyping(fromId, toId, expiresAt) { typing.set(fromId + '>' + toId, expiresAt); },
    async clearTyping(fromId, toId) { typing.delete(fromId + '>' + toId); },
    async getTypingFrom(userId, now) {
      const out = [];
      for (const [key, exp] of typing) {
        const [from, to] = key.split('>');
        if (to === userId && exp > now) out.push(from);
        if (exp <= now) typing.delete(key);
      }
      return out;
    },

    async saveUpload(name, mime, dataB64) { if (!uploads.has(name)) uploads.set(name, { mime, data: dataB64 }); },
    async getUpload(name) { return uploads.get(name) || null; },
  };
}
