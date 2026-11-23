import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAccessCode, makeRateLimiter, checkSpendCap, hashIp } from '../server/guard.js';

test('access code: missing config disables live runs', () => {
  assert.equal(checkAccessCode('x', '').status, 503);
});
test('access code: wrong / empty / right', () => {
  assert.equal(checkAccessCode('nope', 'secret').status, 401);
  assert.equal(checkAccessCode('', 'secret').status, 401);
  assert.equal(checkAccessCode('secret', 'secret').ok, true);
});
test('rate limiter: allows limit, then 429, then reopens after window', () => {
  let t = 0;
  const check = makeRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
  assert.ok(check('a').ok);
  assert.ok(check('a').ok);
  const blocked = check('a');
  assert.equal(blocked.status, 429);
  assert.ok(check('b').ok, 'other visitors unaffected');
  t = 1001;
  assert.ok(check('a').ok);
});
test('spend cap: blocks when committed + reserve exceeds cap', () => {
  assert.ok(checkSpendCap({ spentTodayUsd: 10, activeRuns: 0, capUsd: 25 }).ok);
  assert.equal(checkSpendCap({ spentTodayUsd: 24, activeRuns: 0, capUsd: 25 }).status, 402);
  assert.equal(checkSpendCap({ spentTodayUsd: 18, activeRuns: 3, capUsd: 25 }).status, 402);
});
test('ip hash is salted and stable', () => {
  assert.equal(hashIp('1.2.3.4', 's'), hashIp('1.2.3.4', 's'));
  assert.notEqual(hashIp('1.2.3.4', 's'), hashIp('1.2.3.4', 't'));
});
