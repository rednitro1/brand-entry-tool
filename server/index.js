import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { hashIp, checkAccessCode, makeRateLimiter, checkSpendCap, sessionKey, makeSession, verifySession, readCookie } from './guard.js';
import { parseInput } from './modules/resolve.js';

loadEnv();

const { makeDb } = await import('./db.js');
const { executeRun, MODULES } = await import('./runner.js');
const { executeDraft, currentPlaybook, ENGAGEMENT_MODEL } = await import('./drafts.js');
const { parsePlaybook } = await import('./playbook.js');

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

/* FAKE_MODE=1 is a local-only test harness (in-memory db, recorded responses, no spend).
   It refuses to start anywhere that looks like a deployment. */
const FAKE = process.env.FAKE_MODE === '1';
if (FAKE && (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT)) {
  console.error('[config] FAKE_MODE is for local testing only; refusing to start.');
  process.exit(1);
}
const fake = FAKE ? await import('./devFake.js') : null;
if (FAKE) console.log('[server] FAKE_MODE: in-memory db, recorded responses, no API spend');
const db = FAKE ? fake.makeMemDb() : makeDb(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
await db.failOrphanedRuns().catch((err) => console.error(`[boot] could not clear orphaned runs: ${err.message}`));

const app = express();
app.set('trust proxy', 1); // Railway sits behind one proxy; req.ip is the real client
app.use(express.json({ limit: '64kb' }));

const rateLimit = makeRateLimiter({ limit: Number(RATE_LIMIT_RUNS_PER_IP_PER_HOUR) });
const draftLimit = makeRateLimiter({ limit: Number(process.env.RATE_LIMIT_DRAFTS_PER_IP_PER_HOUR || 10) });
const saveLimit = makeRateLimiter({ limit: 60 });
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(`[api] ${req.method} ${req.path}: ${err.message}`);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.get('/health', (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));

/* Login gate: the access code is pasted once (POST /api/login), which sets a signed,
   httpOnly session cookie. Every other /api route needs that session (or the code in an
   x-access-code header, for scripts). Wrong guesses are rate-limited per visitor. */
const SESSION_COOKIE = 'bet_session';
const SESSION_TTL_MS = 7 * 864e5;
const SECURE_COOKIE = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production');
const sessKey = RUN_ACCESS_CODE ? sessionKey(RUN_ACCESS_CODE, process.env.SESSION_SECRET || IP_HASH_SALT || '') : null;
const loginLimit = makeRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });
const isAuthed = (req) => (sessKey && verifySession(readCookie(req.headers.cookie, SESSION_COOKIE), sessKey))
  || (Boolean(req.get('x-access-code')) && checkAccessCode(req.get('x-access-code'), RUN_ACCESS_CODE).ok);

app.get('/api/session', (req, res) => res.json({ authed: Boolean(isAuthed(req)) }));

app.post('/api/login', (req, res) => {
  const rl = loginLimit(hashIp(req.ip, IP_HASH_SALT));
  if (!rl.ok) return res.status(429).json({ error: 'Too many tries. Wait a few minutes and try again.' });
  const code = checkAccessCode(String(req.body?.code || '').trim(), RUN_ACCESS_CODE);
  if (!code.ok) return res.status(code.status).json({ error: code.status === 401 ? "That access code isn't right." : code.error });
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${makeSession(sessKey, { ttlMs: SESSION_TTL_MS })}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${SECURE_COOKIE ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE_COOKIE ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => (isAuthed(req) ? next() : res.status(401).json({ error: 'Log in with the access code first.', login: true })));

app.get('/api/brands', wrap(async (_req, res) => res.json(await db.listBrands())));

app.get('/api/brands/:slug', wrap(async (req, res) => {
  const bundle = await db.getBrandBundle(String(req.params.slug).slice(0, 80));
  if (!bundle) return res.status(404).json({ error: 'Brand not found.' });
  res.json(bundle);
}));

app.get('/api/runs', wrap(async (_req, res) => {
  const runs = await db.listRuns();
  const capUsd = Number(DAILY_SPEND_CAP_USD);
  res.json({ capUsd, runs });
}));

app.get('/api/runs/:id', wrap(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: 'Bad run id.' });
  const run = await db.getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found.' });
  res.json(run);
}));

/* Start a live run (behind the login gate). Cheap checks first; the rate-limit slot is
   only consumed once the input is valid. */
app.post('/api/runs', wrap(async (req, res) => {
  const input = String(req.body?.input || '').trim();
  if (!input || input.length > 200) return res.status(400).json({ error: 'Enter a brand name or a LinkedIn company URL.' });
  // Reject input the run would fail on anyway, before it costs a run or a rate-limit slot.
  try { parseInput(input); } catch (err) { return res.status(400).json({ error: err.message }); }

  const ipHash = hashIp(req.ip, IP_HASH_SALT);
  const { spentTodayUsd, activeRuns } = await db.spendToday();
  if (activeRuns >= Number(MAX_CONCURRENT_RUNS)) return res.status(429).json({ error: 'Another run is in progress. Try again in a couple of minutes.' });
  const cap = checkSpendCap({ spentTodayUsd, activeRuns, capUsd: Number(DAILY_SPEND_CAP_USD) });
  if (!cap.ok) return res.status(cap.status).json({ error: cap.error });

  const rl = rateLimit(ipHash);
  if (!rl.ok) return res.status(rl.status).set('Retry-After', String(rl.retryAfterSec)).json({ error: rl.error });

  const run = await db.createRun({ input, ipHash, modules: MODULES });
  // Background: the request returns now; the UI polls /api/runs/:id.
  executeRun({ db, runId: run.id, input, ...(FAKE ? { providers: fake.makeFakeProviders() } : {}) }).catch(async (err) => {
    console.error(`[run ${run.id}] crashed: ${err.message}`);
    await db.finishRun(run.id, { status: 'failed', costUsd: 0, error: err.message }).catch(() => {});
  });
  res.status(202).json({ runId: run.id });
}));

/* Playbook: reading and saving are behind the login gate; each save is a new version. */
app.get('/api/playbook', wrap(async (_req, res) => res.json(await currentPlaybook(db))));

app.post('/api/playbook', wrap(async (req, res) => {
  const rl = saveLimit(hashIp(req.ip, IP_HASH_SALT));
  if (!rl.ok) return res.status(rl.status).json({ error: rl.error });
  let content;
  try { content = parsePlaybook(req.body?.content); } catch (err) {
    const first = err.issues?.[0];
    return res.status(400).json({ error: first ? `Playbook field ${first.path.join('.') || '(root)'}: ${first.message}` : 'Invalid playbook.' });
  }
  const row = await db.savePlaybook(content, String(req.body?.note || '').slice(0, 200) || null);
  res.json({ id: row.id, content: row.content, saved: true, created_at: row.created_at });
}));

/* Draft an engagement plan for an account. Same guards as a run: login, spend cap, rate limit. */
app.post('/api/brands/:slug/engagement', wrap(async (req, res) => {
  const slug = String(req.params.slug).slice(0, 80);
  const brand = await db.getBrandBySlug(slug);
  if (!brand) return res.status(404).json({ error: 'Brand not found.' });
  const pickUrls = Array.isArray(req.body?.pickUrls) ? req.body.pickUrls.filter((u) => typeof u === 'string' && /^https:\/\/(www\.)?linkedin\.com\//.test(u)).slice(0, 3) : [];

  const { spentTodayUsd, activeRuns, activeDrafts = 0 } = await db.spendToday();
  if (activeDrafts >= 2) return res.status(429).json({ error: 'Another draft is in progress. Try again in a minute.' });
  const cap = checkSpendCap({ spentTodayUsd, activeRuns, capUsd: Number(DAILY_SPEND_CAP_USD) });
  if (!cap.ok) return res.status(cap.status).json({ error: cap.error });
  const rl = draftLimit(hashIp(req.ip, IP_HASH_SALT));
  if (!rl.ok) return res.status(rl.status).set('Retry-After', String(rl.retryAfterSec)).json({ error: rl.error });

  const { id: playbookId } = await currentPlaybook(db);
  const draft = await db.createDraft({ brandId: brand.id, model: ENGAGEMENT_MODEL(), playbookId });
  executeDraft({ db, draftId: draft.id, slug, pickUrls, ...(FAKE ? { claude: fake.makeFakeDraftClaude() } : {}) })
    .catch((err) => console.error(`[draft ${draft.id}] crashed: ${err.message}`));
  res.status(202).json({ draftId: draft.id });
}));

app.get('/api/drafts/:id', wrap(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: 'Bad draft id.' });
  const d = await db.getDraft(req.params.id);
  if (!d) return res.status(404).json({ error: 'Draft not found.' });
  res.json(d);
}));

/* No delete endpoints exist, by design. */

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
