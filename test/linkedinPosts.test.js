import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mapPost, postPattern, classifyTopic, fetchRecentPosts } from '../server/modules/linkedinPosts.js';

const recorded = JSON.parse(fs.readFileSync(new URL('../fixtures/recorded/harvestapi-posts-kira.json', import.meta.url)));
const elements = recorded.data.alexandria[0].data.elements;
const KIRA = 'https://www.linkedin.com/in/kira-lazzarini/';
const posts = elements.map((e) => mapPost(e, KIRA));

test('mapPost (recorded): reposts detected from author slug, own posts kept', () => {
  assert.equal(posts.length, 9);
  assert.equal(posts.filter((p) => !p.is_repost).length, 4);
  const reposted = posts.filter((p) => p.is_repost).map((p) => p.url);
  assert.ok(reposted.every((u) => !u.includes('kira-lazzarini')));
});

test('mapPost (recorded): the three receipt posts from the brief are present as own posts', () => {
  const own = new Set(posts.filter((p) => !p.is_repost).map((p) => p.url));
  for (const u of [
    'https://www.linkedin.com/posts/kira-lazzarini_i-am-excited-to-share-my-recent-promotion-activity-7381828264761364480-Lra0',
    'https://www.linkedin.com/posts/kira-lazzarini_womenshistorymonth-activity-7439491961046122496-uhQl',
    'https://www.linkedin.com/posts/kira-lazzarini_i-am-thrilled-to-announce-my-promotion-to-activity-7286154482583842817-d6cZ',
  ]) assert.ok(own.has(u), u);
});

test('postPattern (recorded): promotions dominate, no tactics, latest own post is the PepsiCo talk', () => {
  const p = postPattern(posts, new Date('2026-11-22'));
  assert.equal(p.posts_tactics, false);
  assert.equal(p.by_topic.promotion, 2);
  assert.equal(p.latest_own.url, 'https://www.linkedin.com/posts/kira-lazzarini_womenshistorymonth-activity-7439491961046122496-uhQl');
  assert.equal(p.own_last_12_months, 1, 'Mar 2026 only; Oct 2025 is 410 days back');
});

test('classifyTopic edge cases', () => {
  assert.equal(classifyTopic('Here is how we built our creator workflow'), 'tactics');
  assert.equal(classifyTopic(''), 'other');
  assert.equal(classifyTopic(null), 'other');
});

test('mapPost: missing engagement -> null, not 0', () => {
  const p = mapPost({ linkedinUrl: 'https://www.linkedin.com/posts/kira-lazzarini_x', content: 'hi' }, KIRA);
  assert.equal(p.reactions, null);
  assert.equal(p.is_repost, false);
});

test('postPattern: nobody posts -> zeros and null latest', () => {
  const p = postPattern([]);
  assert.equal(p.own, 0);
  assert.equal(p.latest_own, null);
});

test('fetchRecentPosts (stub alexandria) maps the recorded payload', async () => {
  const fc = { async alexandria(prov, cap, opts) { assert.equal(prov, 'harvestapi'); assert.equal(opts.profile, KIRA); return recorded.data.alexandria[0].data; } };
  const r = await fetchRecentPosts({ fc, profileUrl: KIRA });
  assert.equal(r.posts.length, 9);
  assert.equal(r.pattern.reposts, 5);
});
