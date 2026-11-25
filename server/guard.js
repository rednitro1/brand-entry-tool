import crypto from 'node:crypto';

/* Public-URL safeguards for live (paid) runs. Cached example brands never pass through
   here: reading them costs nothing. Every check returns {ok, status, error} so the route
   can answer with a clear 401 / 429 / 402 instead of a generic failure. */

export function hashIp(ip, salt) {
  return crypto.createHash('sha256').update(`${salt || ''}:${ip || 'unknown'}`).digest('hex').slice(0, 32);
}

/* Constant-time compare so the access code can't be guessed by response timing. */
export function checkAccessCode(given, expected) {
  if (!expected) return { ok: false, status: 503, error: 'Live runs are disabled: no access code is configured on the server.' };
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: 'A valid access code is required for live runs. The Alani Nu example is open without one.' };
  }
  return { ok: true };
}

/* Sliding one-hour window per IP hash. In-memory is fine: one Railway instance, and a
   restart only resets the window (the daily spend cap, which lives in the DB, still holds). */
export function makeRateLimiter({ limit, windowMs = 60 * 60 * 1000, now = () => Date.now() }) {
  const hits = new Map(); // ipHash -> [timestamps]
  return function check(ipHash) {
    const t = now();
    const recent = (hits.get(ipHash) || []).filter((x) => t - x < windowMs);
    if (recent.length >= limit) {
      const retryAfterSec = Math.ceil((windowMs - (t - recent[0])) / 1000);
      hits.set(ipHash, recent);
      return { ok: false, status: 429, retryAfterSec, error: `Rate limit: ${limit} live runs per hour per visitor. Try again in ${Math.ceil(retryAfterSec / 60)} min.` };
    }
    recent.push(t);
    hits.set(ipHash, recent);
    return { ok: true };
  };
}

/* spentToday includes runs still in flight (their cost so far) plus a reserve for each
   active run, so two concurrent runs can't both slip under the cap. */
export function checkSpendCap({ spentTodayUsd, activeRuns, capUsd, reservePerRunUsd = 2 }) {
  const committed = Number(spentTodayUsd || 0) + Number(activeRuns || 0) * reservePerRunUsd;
  if (committed + reservePerRunUsd > capUsd) {
    return { ok: false, status: 402, error: `Daily spend cap reached ($${capUsd}). Live runs reopen at 00:00 UTC. The cached example still works.` };
  }
  return { ok: true, committed };
}

/* Login sessions: the access code is entered once, then a signed cookie carries the
   session. The key is derived from the access code, so changing the code logs everyone
   out. Token = "<expiry ms>.<hmac>"; nothing secret is stored in the browser. */
export function sessionKey(accessCode, secret = '') {
  return crypto.createHash('sha256').update(`session:${secret}:${accessCode || ''}`).digest();
}
export function makeSession(key, { now = Date.now(), ttlMs = 7 * 864e5 } = {}) {
  const exp = String(now + ttlMs);
  return `${exp}.${crypto.createHmac('sha256', key).update(exp).digest('hex')}`;
}
export function verifySession(token, key, { now = Date.now() } = {}) {
  const m = /^(\d{10,16})\.([0-9a-f]{64})$/.exec(String(token || ''));
  if (!m || !key || Number(m[1]) < now) return false;
  const want = crypto.createHmac('sha256', key).update(m[1]).digest();
  const got = Buffer.from(m[2], 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
export function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
