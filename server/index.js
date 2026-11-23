import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { hashIp, checkAccessCode, makeRateLimiter, checkSpendCap } from './guard.js';

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');

const {
  PORT = 8080,
  RUN_ACCESS_CODE,
  IP_HASH_SALT,
  DAILY_SPEND_CAP_USD = '25',
  RATE_LIMIT_RUNS_PER_IP_PER_HOUR = '3',
} = process.env;

const app = express();
app.set('trust proxy', 1); // Railway sits behind one proxy; req.ip is the real client
app.use(express.json({ limit: '64kb' }));

const rateLimit = makeRateLimiter({ limit: Number(RATE_LIMIT_RUNS_PER_IP_PER_HOUR) });

app.get('/health', (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));

/* Start a live run. Order matters: cheap checks first, and the rate-limit slot is only
   consumed once the access code is valid, so a wrong code can't lock out a visitor. */
app.post('/api/runs', async (req, res) => {
  const code = checkAccessCode(req.get('x-access-code') || req.body?.accessCode, RUN_ACCESS_CODE);
  if (!code.ok) return res.status(code.status).json({ error: code.error });

  const input = String(req.body?.input || '').trim();
  if (!input || input.length > 200) return res.status(400).json({ error: 'Enter a brand name or a LinkedIn company URL.' });

  const ipHash = hashIp(req.ip, IP_HASH_SALT);
  const rl = rateLimit(ipHash);
  if (!rl.ok) return res.status(rl.status).set('Retry-After', String(rl.retryAfterSec)).json({ error: rl.error });

  // Spend-cap inputs come from the runs table once the DB is wired (step 1b).
  const cap = checkSpendCap({ spentTodayUsd: 0, activeRuns: 0, capUsd: Number(DAILY_SPEND_CAP_USD) });
  if (!cap.ok) return res.status(cap.status).json({ error: cap.error });

  return res.status(501).json({ error: 'Live runs are not wired up yet.' });
});

/* No delete or mutation endpoints exist beyond POST /api/runs, by design. */

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
