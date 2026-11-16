# Messenger — Vercel + Neon variant

The deployable twin of the standalone messenger in `../app/`. Same client,
same HTTP API, same payloads — the only difference is the engine room:
Vercel serverless functions + Neon Postgres instead of one long-running
Node process with a JSON file on disk. It exists because `*.vercel.app` is
proven to open from Iran without a VPN (the Pishmashool precedent), while
WHC/github.io are not.

`../app/` is untouched and remains the standalone package — including the
future Abr Arvan (Iran) server package. This folder is only for the
Vercel deploy of the main server.

## Layout

- `public/` — the messenger client, byte-identical to `../app/public/`
  except the service-worker cache name (`messenger-shell-v4`). Approved
  blue/white theme, Roliett-style SVG icons, doodle chat background, final
  fire logo as icon. No sticker section.
- `api/_lib.js` — all endpoint handlers, ported 1:1 from `../app/server.js`
  (framework-free `{status, json, headers}` handlers + an `adapt()` wrapper,
  the Pishmashool pattern).
- `api/_db.js` — the ONLY module that talks to Postgres. Everything sits
  behind a small store interface (users, sessions, contacts, messages,
  signals, typing, uploads, sequence counters). Schema is created
  idempotently and lazily on the first request of a cold instance
  (`ensureInit`); `schema.sql` in this folder is the same schema for review.
- `api/*.js` — one Vercel function per endpoint (see mapping below).
- `api/uploads/[name].js` + the rewrite in `vercel.json` — serves
  `/uploads/<uuid>.<ext>` from the `uploads` table with HTTP Range support
  (voice-message seeking), like the standalone file server.
- `api/_config.js` — deployment config (dual-server switch, Iran endpoint,
  STUN/TURN), env-driven.
- `test/smoke.mjs` — the standalone 42-check smoke suite re-run against the
  handlers with an in-memory store (`test/memstore.mjs`). `npm test`.

## Environment variables (Vercel project settings)

| Var | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | Neon Postgres connection string. Without it every API call fails with `server_error` (the code throws `DATABASE_URL is not set`). |
| `TURN_SERVERS_JSON` | no | JSON array of TURN server objects (same shape as standalone `config.json` `TURN_SERVERS`), e.g. `[{"urls":"turn:turn.example.com:3478","username":"…","credential":"…"}]`. Delivered to clients via `/api/config` → `iceServers`. Empty = STUN-only (calls may fail on strict Iranian carrier NATs until a TURN relay is added). |
| `STUN_SERVERS_JSON` | no | JSON array of STUN urls. Default: the two Google STUN servers from the standalone config. |
| `SYNC_SECRET` | no | Shared secret for the future server-to-server sync. Only relevant when the Iran switch is ever turned on. |
| `IRAN_SERVER_ENABLED` | no | The dual-server switch. Leave unset / `false`. Setting `true` only makes sense the day the Arvan copy exists. |
| `IRAN_ENDPOINT` | no | Fixed "Iran address" the clients probe when the switch is on. Default placeholder `https://iran.messenger.invalid`; point it at the real Arvan address when that server is bought — no app update needed. |

## Deploy

1. Create a Neon project/database; copy its pooled connection string.
2. Create a Vercel project from this folder (`vercel` CLI or git import);
   set `DATABASE_URL` (and optionally `TURN_SERVERS_JSON`) in Project
   Settings → Environment Variables.
3. Deploy. First API hit creates the schema automatically.
4. Open the `*.vercel.app` URL, sign up two accounts on two phones, and run
   the deploy-time checks listed below.

## Endpoint mapping (standalone → Vercel)

| Standalone (`app/server.js`) | Vercel function |
| --- | --- |
| `GET /api/ping` | `api/ping.js` |
| `GET /api/config` | `api/config.js` |
| `POST /api/signup` · `POST /api/login` · `POST /api/logout` | `api/signup.js` · `api/login.js` · `api/logout.js` |
| `POST /api/sync` (stub, switch-guarded) | `api/sync.js` |
| `GET /api/me` | `api/me.js` |
| `GET/POST /api/contacts` | `api/contacts.js` |
| `POST /api/messages` (UUID dedupe incl.) | `api/messages.js` |
| `POST /api/messages/edit` · `/delete` · `/react` | `api/messages/edit.js` · `delete.js` · `react.js` |
| `POST /api/seen` · `POST /api/typing` | `api/seen.js` · `api/typing.js` |
| `POST /api/upload` | `api/upload.js` |
| `GET /uploads/<name>` (Range) | `api/uploads/[name].js` via `vercel.json` rewrite |
| `POST /api/signal` | `api/signal.js` |
| `GET /api/poll?seq&sig` | `api/poll.js` |
| Static shell (`public/`) | Vercel static hosting |

State that was in-memory in the standalone (sessions, typing, signal inbox,
seq counters) lives in Postgres tables here — required because serverless
functions are stateless. Behaviour and payloads are unchanged.

## Dual-server switch

Still OFF (`IRAN_SERVER_ENABLED=false`), exactly as decided: no Arvan server
is bought until/unless the internet goes national. Messages keep their
client UUID + timestamp + global sequence, so the future UUID-based merge
(`/api/sync`, still a guarded stub) can combine both stores without
collisions. Turning it on later = buy Arvan, deploy `../app/` there, set
`IRAN_ENDPOINT` + a shared `SYNC_SECRET` here, flip the switch. Phones need
no update.

## Honest limits — what is NOT verified yet

Local verification (done): `node --check` on every JS file; all 18 endpoint
modules import cleanly against the real `@neondatabase/serverless` package;
the full 42-check smoke suite passes against the handlers with the
in-memory store (auth, contacts, messaging, dedupe, ticks, edit/react/
delete, typing, upload + Range playback, signal relay, call cards, config,
sync stub, static shell files).

NOT verified, and cannot be from this VM: **the Neon code paths themselves.**
This VM's egress blocks Postgres SSL to Neon (the KANZIKO lesson), so
`api/_db.js` SQL has never run against a live database. After deploy, verify
in this order:

1. `GET /api/ping` → 200. Then `POST /api/signup` → 201 (this is the first
   call that touches the DB — it proves `DATABASE_URL`, schema creation and
   the users/sessions tables in one shot).
2. In the Neon console, confirm the tables from `schema.sql` exist.
3. Two accounts → add contact → send a message → check delivered/seen ticks
   on the second phone (proves messages, counters, poll).
4. Send a voice message and seek in it (proves uploads + Range), send a
   photo.
5. Place a voice and a video call between two real phones — WebRTC media
   never passes through these functions, but Iranian carrier NAT behaviour
   (and whether the TURN relay is needed) can only be proven on devices.
