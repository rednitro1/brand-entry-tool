import test from 'node:test';
import assert from 'node:assert/strict';
import { namesBrand, brandWords } from '../server/modules/engagement.js';

test('brandWords: keeps the identifying words, drops category words', () => {
  assert.deepEqual(brandWords('Fenty Beauty'), ['Fenty']);
  assert.deepEqual(brandWords('Monster Energy'), ['Monster']);
  assert.deepEqual(brandWords('Bloom Nutrition'), ['Bloom']);
  assert.deepEqual(brandWords('Colgate-Palmolive'), ['Colgate', 'Palmolive']);
});

test('namesBrand: category words in an own post are not the brand (Fenty false flag)', () => {
  assert.deepEqual(namesBrand('The hottest beauty brands in 2026 work with us.', 'Fenty Beauty'), []);
  assert.deepEqual(namesBrand('Energy drinks are having a moment.', 'Monster Energy'), []);
});

test('namesBrand: the real name is still caught', () => {
  assert.deepEqual(namesBrand('Fenty fans already know this.', 'Fenty Beauty'), ['Fenty']);
  assert.deepEqual(namesBrand('Monster keeps winning.', 'Monster Energy'), ['Monster']);
  assert.deepEqual(namesBrand('Like Bloom, they move fast.', 'Bloom Nutrition'), ['Bloom']);
  assert.deepEqual(namesBrand('Water Co is great.', 'Water Co'), ['Water Co'], 'all-generic names fall back to the full name');
});
