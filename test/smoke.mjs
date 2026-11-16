// Smoke test — the same 42 checks as the standalone app's smoke-test.js,
// re-run against the Vercel variant WITH the in-memory store
// (test/memstore.mjs) standing in for Neon. Every API request goes through
// the real dispatcher (api/_router.js behind api/dispatch.js — the single
// Serverless Function the live site uses), with fake req/res presented
// exactly the way Vercel presents them after the vercel.json rewrites:
// req.url is /api/dispatch?path=<segments after /api/> (plus the client's
// own query params, which Vercel merges into the rewritten URL) and
// req.query carries those params plus `path`. Run: npm test
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApiHandler } from '../api/_router.js';
import { createMemoryStore } from './memstore.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');
const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  — ' + extra : ''));
}

const store = createMemoryStore();
const api = createApiHandler(() => store);

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    send(buf) { this.body = buf; return this; },
  };
}

// One raw request through the dispatcher, returned in the { status, json,
// headers, buffer } shape the checks below consume. `pathname` is the
// PUBLIC path the client requests; it is translated into the rewritten
// invocation the live function receives — /api/<rest> becomes
// path=<rest>, and /uploads/<name> becomes path=uploads/<name> — exactly
// as the two vercel.json rewrites present it to api/dispatch.js.
async function callApi(pathname, method, body, query, headers) {
  let rel;
  if (pathname.startsWith('/api/')) rel = pathname.slice('/api/'.length);
  else if (pathname.startsWith('/uploads/')) rel = pathname.slice(1);
  else rel = pathname.replace(/^\//, '');
  const qs = query && Object.keys(query).length ? '&' + new URLSearchParams(query).toString() : '';
  const req = {
    method,
    url: '/api/dispatch?path=' + rel + qs,
    headers: headers || {},
    body: body || {},
    query: Object.assign({}, query || {}, { path: rel }),
  };
  const res = fakeRes();
  await api(req, res);
  const out = { status: res.statusCode, headers: res.headers };
  if (Buffer.isBuffer(res.body)) out.buffer = res.body;
  else out.json = res.body;
  return out;
}

// Fake client: keeps the sid cookie between dispatcher calls, like a browser.
function client() {
  let cookie = '';
  return {
    async call(pathname, method, body, query) {
      const out = await callApi(pathname, method, body, query, { cookie });
      const sc = out.headers && out.headers['Set-Cookie'];
      if (sc) cookie = sc.split(';')[0];
      return out;
    },
  };
}

const A = client(), B = client(), C = client();

let r = await A.call('/api/signup', 'POST', { username: 'alice', password: 'alice-pass' });
check('signup alice', r.status === 201 && r.json.user.username === 'alice');
const aliceId = r.json.user.id;
r = await B.call('/api/signup', 'POST', { username: 'bob', password: 'bob-pass-1' });
check('signup bob', r.status === 201);
const bobId = r.json.user.id;

r = await A.call('/api/signup', 'POST', { username: 'alice', password: 'whatever1' });
check('duplicate username rejected', r.status === 409);

r = await C.call('/api/login', 'POST', { username: 'alice', password: 'wrong-pass' });
check('wrong password rejected', r.status === 401);
r = await C.call('/api/login', 'POST', { username: 'bob', password: 'bob-pass-1' });
check('login bob (2nd client)', r.status === 200);

r = await A.call('/api/contacts', 'POST', { username: 'bob' });
check('alice adds bob', r.status === 200 && r.json.contact.id === bobId);
r = await B.call('/api/contacts', 'GET');
check('bob sees alice back (mutual)', r.json.contacts.some((c) => c.id === aliceId));

// message A -> B with a client uuid (offline-queue style)
const mId = crypto.randomUUID();
r = await A.call('/api/messages', 'POST', { id: mId, to: bobId, type: 'text', text: 'salam bob', ts: Date.now() });
check('alice sends message', r.status === 201 && r.json.message.text === 'salam bob');
check('message has uuid+seq+ts', r.json.message.id === mId && r.json.message.seq > 0 && r.json.message.ts > 0);
r = await A.call('/api/messages', 'POST', { id: mId, to: bobId, type: 'text', text: 'salam bob', ts: Date.now() });
check('resend same uuid deduped', r.status === 200 && r.json.deduped === true);

// B polls -> receives, and that poll marks it delivered
r = await B.call('/api/poll', 'GET', null, { seq: '0', sig: '0' });
const got = r.json.messages.find((m) => m.id === mId);
check('bob receives via poll', !!got);
check('delivered tick set after bob poll', !!got && !!got.deliveredAt, got && ('deliveredAt=' + got.deliveredAt));

// B marks seen -> A polls and sees seenAt
await B.call('/api/seen', 'POST', { with: aliceId });
r = await A.call('/api/poll', 'GET', null, { seq: '0', sig: '0' });
const seenMsg = r.json.messages.find((m) => m.id === mId);
check('seen tick advances for alice', !!seenMsg && !!seenMsg.seenAt);

// reply B -> A with quote
r = await B.call('/api/messages', 'POST', { to: aliceId, type: 'text', text: 'salam alice!', replyTo: { id: mId, from: aliceId, text: 'salam bob', type: 'text' }, ts: Date.now() });
check('bob replies with quote', r.status === 201 && r.json.message.replyTo && r.json.message.replyTo.id === mId);
const replyId = r.json.message.id;
r = await A.call('/api/poll', 'GET', null, { seq: '0', sig: '0' });
check('alice receives reply', r.json.messages.some((m) => m.id === replyId));

// reaction + edit + delete
r = await A.call('/api/messages/react', 'POST', { id: replyId, emoji: '❤️' });
check('heart reaction', r.status === 200 && r.json.message.reaction[aliceId] === '❤️');
r = await A.call('/api/messages/edit', 'POST', { id: mId, text: 'salam bob (edited)' });
check('edit own message', r.status === 200 && r.json.message.edited === true && r.json.message.text.includes('edited'));
r = await A.call('/api/messages/delete', 'POST', { id: mId });
check('delete own message', r.status === 200 && r.json.message.deleted === true);

// typing indicator
await A.call('/api/typing', 'POST', { to: bobId, typing: true });
r = await B.call('/api/poll', 'GET', null, { seq: '0', sig: '0' });
check('typing indicator reaches bob', r.json.typing[aliceId] === true);

// uploads: voice (fake webm bytes) + photo (1x1 png). File fetches use
// the public /uploads/<name> path — the vercel.json rewrite turns it into
// the dispatch invocation path=uploads/<name>, which callApi reproduces.
const voiceBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
const voiceB64 = voiceBytes.toString('base64');
r = await A.call('/api/upload', 'POST', { kind: 'voice', mime: 'audio/webm', data: voiceB64 });
check('voice upload', r.status === 201 && r.json.url.startsWith('/uploads/'));
const voiceName = r.json.url.split('/').pop();
let fr = await callApi('/uploads/' + voiceName, 'GET', null, null, {});
check('voice file served', fr.status === 200 && Buffer.compare(fr.buffer, voiceBytes) === 0);
fr = await callApi('/uploads/' + voiceName, 'GET', null, null, { range: 'bytes=0-3' });
check('voice file supports Range (seek)', fr.status === 206 && fr.buffer.length === 4 && String(fr.headers['Content-Range']).startsWith('bytes 0-3/'));
r = await A.call('/api/messages', 'POST', { to: bobId, type: 'voice', media: '/uploads/' + voiceName, ts: Date.now() });
check('voice message sent', r.status === 201 && r.json.message.type === 'voice');

const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
r = await A.call('/api/upload', 'POST', { kind: 'photo', mime: 'image/png', data: pngB64 });
check('photo upload', r.status === 201 && r.json.url.endsWith('.png'));
r = await A.call('/api/messages', 'POST', { to: bobId, type: 'photo', media: r.json.url, ts: Date.now() });
check('photo message sent', r.status === 201 && r.json.message.type === 'photo');

// WebRTC signaling relay: offer A->B, answer B->A, ice both ways
const callId = crypto.randomUUID();
r = await A.call('/api/signal', 'POST', { to: bobId, kind: 'offer', callId, media: 'video', payload: { type: 'offer', sdp: 'FAKE_SDP_OFFER' } });
check('offer signal accepted', r.status === 201);
r = await B.call('/api/poll', 'GET', null, { seq: '0', sig: '0' });
const offerSig = r.json.signals.find((s) => s.kind === 'offer' && s.callId === callId);
check('bob receives offer via poll', !!offerSig && offerSig.payload.sdp === 'FAKE_SDP_OFFER' && offerSig.media === 'video');
await B.call('/api/signal', 'POST', { to: aliceId, kind: 'answer', callId, media: 'video', payload: { type: 'answer', sdp: 'FAKE_SDP_ANSWER' } });
await B.call('/api/signal', 'POST', { to: aliceId, kind: 'ice', callId, payload: { candidate: 'candidate:1' } });
r = await A.call('/api/poll', 'GET', null, { seq: '0', sig: '0' });
check('alice receives answer', r.json.signals.some((s) => s.kind === 'answer' && s.payload.sdp === 'FAKE_SDP_ANSWER'));
check('alice receives ICE candidate', r.json.signals.some((s) => s.kind === 'ice'));

// call event card in thread
r = await A.call('/api/messages', 'POST', { to: bobId, type: 'call', callInfo: { kind: 'video', outcome: 'ended', durationSec: 125 }, ts: Date.now() });
check('call event recorded', r.status === 201 && r.json.message.callInfo.durationSec === 125);
r = await B.call('/api/poll', 'GET', null, { seq: '0', sig: '0' });
check('bob sees call event', r.json.messages.some((m) => m.type === 'call'));

// dual-server switch + sync stub
r = await A.call('/api/config', 'GET');
check('config exposes switch OFF', r.json.iranServerEnabled === false);
check('config exposes fixed Iran endpoint', typeof r.json.iranEndpoint === 'string' && r.json.iranEndpoint.length > 0, r.json.iranEndpoint);
check('config exposes STUN ice servers', Array.isArray(r.json.iceServers) && r.json.iceServers.length >= 1);
r = await A.call('/api/sync', 'POST', {});
check('sync stub disabled while switch off', r.status === 403 && r.json.enabled === false && r.json.error === 'iran_sync_disabled');

// static shell (served by Vercel from public/ — verify the files ship intact)
const html = readFileSync(path.join(publicDir, 'index.html'), 'utf8');
check('index page serves', html.includes('Messenger'));
check('client has offline queue code', html.includes('localStorage') && html.includes('flushQueue'));
check('client has ICE-restart reconnect', html.includes('iceRestart') && html.includes('Reconnecting'));
check('client has adaptive video-off', html.includes('Video off'));
let manifestOk = false;
try { manifestOk = !!JSON.parse(readFileSync(path.join(publicDir, 'manifest.json'), 'utf8')).name; } catch (e) { /* bad json */ }
check('PWA manifest serves', manifestOk);
const sw = readFileSync(path.join(publicDir, 'sw.js'), 'utf8');
check('service worker serves', sw.includes('messenger-shell-v4'));
check('placeholder icon serves', existsSync(path.join(publicDir, 'icon.png')) && statSync(path.join(publicDir, 'icon.png')).size > 0);

const failed = results.filter((x) => !x.ok);
console.log('\n==== ' + (results.length - failed.length) + '/' + results.length + ' passed ====');
process.exitCode = failed.length ? 1 : 0;
