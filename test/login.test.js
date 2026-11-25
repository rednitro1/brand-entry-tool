import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionKey, makeSession, verifySession, readCookie } from '../server/guard.js';

const key = sessionKey('the-code', 'salt');

test('session: a fresh token verifies; tampered, expired or foreign tokens do not', () => {
  const now = Date.UTC(2026, 10, 24);
  const t = makeSession(key, { now, ttlMs: 1000 });
  assert.equal(verifySession(t, key, { now: now + 500 }), true);
  assert.equal(verifySession(t, key, { now: now + 1500 }), false, 'expired');
  const [exp, sig] = t.split('.');
  assert.equal(verifySession(`${Number(exp) + 1}.${sig}`, key, { now }), false, 'expiry edited');
  assert.equal(verifySession(`${exp}.${'0'.repeat(64)}`, key, { now }), false, 'signature forged');
  assert.equal(verifySession(t, sessionKey('new-code', 'salt'), { now }), false, 'changing the code logs everyone out');
  assert.equal(verifySession('', key), false);
  assert.equal(verifySession('garbage', key), false);
});

test('readCookie: finds the session cookie among others', () => {
  assert.equal(readCookie('a=1; bet_session=123.abc; b=2', 'bet_session'), '123.abc');
  assert.equal(readCookie('a=1', 'bet_session'), null);
  assert.equal(readCookie(undefined, 'bet_session'), null);
});
