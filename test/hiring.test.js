import test from 'node:test';
import assert from 'node:assert/strict';
import { isHiringPost, buildSignals } from '../shared/signals.js';
import { commentStyleProblems } from '../server/modules/engagement.js';

const BEN = "Hey, I personally don't need a job, but it seems like your social media operations are getting heavy. Just DM'd.";

test('isHiringPost: job announcements yes, team shout-outs no', () => {
  assert.ok(isHiringPost('The Alani social team is hiring! If you love connecting with people online and all things social, apply below!'));
  assert.ok(isHiringPost("We're hiring a Social Media Manager"));
  assert.ok(isHiringPost('Join our growing creator team'));
  assert.ok(isHiringPost('Hiring for our CX team in Austin'));
  assert.ok(!isHiringPost('Please welcome Kira who joined the team!'));
  assert.ok(!isHiringPost('Proud of this team and this launch.'));
});

test("commentStyleProblems: Ben's hiring comment passes on a hiring post, not on a normal one", () => {
  assert.deepEqual(commentStyleProblems(BEN, { hiring: true }), []);
  assert.deepEqual(commentStyleProblems("Chronically online as a job requirement is the most honest line I've seen in a job post.", { hiring: true }), []);
  assert.match(commentStyleProblems(BEN).join(' '), /2 sentences/);
  assert.match(commentStyleProblems('One. Two. Three.', { hiring: true }).join(' '), /3 sentences/);
});

test('buildSignals: hiring posts from the past year show up in a Hiring group', () => {
  const now = new Date(Date.UTC(2026, 10, 24));
  const bundle = {
    brand: { name: 'Alani Nu' },
    profile: { facts: [] },
    stakeholders: [{ full_name: 'Mariah Justice', started_role_at: null, stakeholder_posts: [
      { url: 'https://li/1', posted_at: '2026-09-23T10:00:00Z', text: 'The Alani social team is hiring! Apply below!' },
      { url: 'https://li/2', posted_at: '2026-09-01T10:00:00Z', text: 'Great day at the office.' },
      { url: 'https://li/3', posted_at: '2024-01-01T10:00:00Z', text: "We're hiring a community manager" },
    ] }],
    brandPosts: [{ url: 'https://li/1', posted_at: '2026-09-23T10:00:00Z', caption: 'The Alani social team is hiring! Apply below!' }],
  };
  const hiring = buildSignals(bundle, now).groups.find((g) => g.key === 'hiring');
  assert.equal(hiring.items.length, 1, 'one per post, past year only');
  assert.match(hiring.items[0].text, /^Mariah Justice posted an opening/);
  assert.equal(hiring.items[0].ref.type, 'post');
});
