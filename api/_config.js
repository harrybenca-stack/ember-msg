// Deployment config for the Vercel variant — mirrors app/config.json of the
// standalone package. Deployment-specific values and secrets come from env.
//
// Dual-server switch (Parsa, Nov 16 2026): IRAN_SERVER_ENABLED stays false.
// The client already knows the fixed IRAN_ENDPOINT placeholder and probes it
// ONLY when the switch is on. When the Abr Arvan server is bought one day,
// set IRAN_ENDPOINT to its real address and flip the switch — no app update.
function parseJsonEnv(name, fallback) {
  try {
    const v = process.env[name];
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
}

export const CONFIG = {
  IRAN_SERVER_ENABLED: process.env.IRAN_SERVER_ENABLED === 'true' || process.env.IRAN_SERVER_ENABLED === '1',
  IRAN_ENDPOINT: process.env.IRAN_ENDPOINT || 'https://iran.messenger.invalid',
  STUN_SERVERS: parseJsonEnv('STUN_SERVERS_JSON', ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']),
  TURN_SERVERS: parseJsonEnv('TURN_SERVERS_JSON', []),
  SYNC_SECRET: process.env.SYNC_SECRET || '',
};
