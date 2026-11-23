import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { hashIp, checkAccessCode, makeRateLimiter, checkSpendCap } from './guard.js';

loadEnv();

const { makeDb } = await import('./db.js');
const { executeRun, MODULES } = await import('./runner.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');

const {
  PORT = 8080,
  RUN_ACCESS_CODE,
  IP_HASH_SALT,
  DAILY_SPEND_CAP_USD = '25',
  RATE_LIMIT_RUNS_PER_IP_PER_HOUR = '3',
  MAX_CONCURRENT_RUNS = '2',
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!v) console.error(`[config] missing required env var ${k}`);
}

const db = makeDb(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
await db.failOrphanedRuns().catch((err) => console.error(`[boot] could not clear orphaned runs: ${err.message}`));

const app = express();
app.set('trust proxy', 1); // Railway sits behind one proxy; req.ip is the real client
app.use(express.json({ limit: '64kb' }));

const rateLimit = makeRateLimiter({ limit: Number(RATE_LIMIT_RUNS_PER_IP_PER_HOUR) });
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(`[api] ${req.method} ${req.path}: ${err.message}`);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.get('/health', (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));

app.get('/api/brands', wrap(async (_req, res) => res.json(await db.listBrands())));

app.get('/api/brands/:slug', wrap(async (req, res) => {
  const bundle = await db.getBrandBundle(String(req.params.slug).slice(0, 80));
  if (!bundle) return res.status(404).json({ error: 'Brand not found.' });
  res.json(bundle);
}));

app.get('/api/runs/:id', wrap(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: 'Bad run id.' });
  const run = await db.getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found.' });
  res.json(run);
}));

/* Start a live run. Cheap checks first; the rate-limit slot is only consumed once the
   access code is valid, so a wrong code can't lock a visitor out. */
app.post('/api/runs', wrap(async (req, res) => {
  const code = checkAccessCode(req.get('x-access-code') || req.body?.accessCode, RUN_ACCESS_CODE);
  if (!code.ok) return res.status(code.status).json({ error: code.error });

  const input = String(req.body?.input || '').trim();
  if (!input || input.length > 200) return res.status(400).json({ error: 'Enter a brand name or a LinkedIn company URL.' });

  const ipHash = hashIp(req.ip, IP_HASH_SALT);
  const { spentTodayUsd, activeRuns } = await db.spendToday();
  if (activeRuns >= Number(MAX_CONCURRENT_RUNS)) return res.status(429).json({ error: 'Another run is in progress. Try again in a couple of minutes.' });
  const cap = checkSpendCap({ spentTodayUsd, activeRuns, capUsd: Number(DAILY_SPEND_CAP_USD) });
  if (!cap.ok) return res.status(cap.status).json({ error: cap.error });

  const rl = rateLimit(ipHash);
  if (!rl.ok) return res.status(rl.status).set('Retry-After', String(rl.retryAfterSec)).json({ error: rl.error });

  const run = await db.createRun({ input, ipHash, modules: MODULES });
  // Background: the request returns now; the UI polls /api/runs/:id.
  executeRun({ db, runId: run.id, input }).catch(async (err) => {
    console.error(`[run ${run.id}] crashed: ${err.message}`);
    await db.finishRun(run.id, { status: 'failed', costUsd: 0, error: err.message }).catch(() => {});
  });
  res.status(202).json({ runId: run.id });
}));

/* No delete or mutation endpoints exist beyond POST /api/runs, by design. */

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
