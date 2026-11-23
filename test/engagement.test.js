import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mapCompanyPost } from '../server/modules/linkedinPosts.js';
import {
  collectPosts, rankCandidates, chooseTarget, buildEvidence, extractNumbers, unsupportedNumbers, validateDraft, draftEngagement,
} from '../server/modules/engagement.js';
import { SEED_PLAYBOOK, parsePlaybook } from '../server/playbook.js';

const NOW = new Date('2026-11-22T12:00:00Z');
const company = JSON.parse(fs.readFileSync(new URL('../fixtures/recorded/harvestapi-company-posts-bloom.json', import.meta.url))).data.alexandria[0].data.elements.map(mapCompanyPost);
const brandPosts = company.map((p) => ({ url: p.url, caption: p.text, posted_at: p.posted_at, likes: p.reactions, comments: p.comments, is_repost: p.is_repost, author: p.author }));

// STUB bundle shaped like getBrandBundle for Bloom: the wedge persona never posts; a team
// member reposts brand posts and has one own post.
function bundle() {
  return {
    brand: { name: 'Bloom Nutrition Llc', slug: 'bloom-nutrition-llc', domain: 'bloomnu.com' },
    profile: { facts: [{ id: 'f1', claim: 'Bloom sells Sparkling Energy in Woolworths', quote: 'available chain-wide', url: 'https://example.com/a' }] },
    social: [
      { platform: 'instagram', handle: 'bloomnu', url: 'https://instagram.com/bloomnu', followers: 811764, post_count: 2064 },
      { platform: 'tiktok', handle: 'bloomnu', url: 'https://tiktok.com/@bloomnu', followers: 974800, post_count: 2426 },
      { platform: 'linkedin', handle: 'bloom-nutrition-llc', url: 'https://linkedin.com/company/bloom-nutrition-llc', followers: 166583 },
    ],
    stakeholders: [
      { id: 's1', full_name: 'Sydney Specht', title: 'Director of Influencer Marketing', persona: 'director_social', linkedin_url: 'https://linkedin.com/in/sydneyspecht', stakeholder_posts: [] },
      {
        id: 's2', full_name: 'Emma Price', title: 'Influencer Marketing Manager', persona: 'team_social', linkedin_url: 'https://linkedin.com/in/emma-lily-price',
        stakeholder_posts: [
          { url: brandPosts[6].url, posted_at: brandPosts[6].posted_at, text: brandPosts[6].caption, is_repost: true, reactions: 255, comments: 6 },
          { url: 'https://www.linkedin.com/posts/emma-lily-price_creator-summit', posted_at: '2026-11-01T10:00:00Z', text: 'Wrapped our first creator summit with 40 creators in LA. Biggest lesson: briefs that leave room for the creator voice outperform scripted ones.', is_repost: false, reactions: 120, comments: 14 },
        ],
      },
    ],
    brandPosts,
  };
}
const playbook = parsePlaybook(SEED_PLAYBOOK);

test('seed playbook passes its own schema and every proof item has a source', () => {
  assert.ok(playbook.proof.length >= 10);
  assert.ok(playbook.proof.every((p) => p.source_url.startsWith('https://')));
});

test('collectPosts: a brand post reposted by the team is kept once, as the team copy', () => {
  const posts = collectPosts(bundle());
  const dupes = posts.filter((p) => p.url === brandPosts[6].url);
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].source, 'team');
});

test('rankCandidates: last 90 days with text only; team own post beats brand posts', () => {
  const ranked = rankCandidates(collectPosts(bundle()), NOW);
  assert.ok(ranked.every((p) => new Date(p.posted_at) > new Date('2026-08-24') && p.text.length >= 40));
  assert.equal(ranked[0].author, 'Emma Price');
  assert.equal(ranked[0].is_repost, false);
});

test('chooseTarget: the wedge persona even when they never post; flagged fallback otherwise', () => {
  assert.equal(chooseTarget(bundle().stakeholders).person.full_name, 'Sydney Specht');
  const noWedge = chooseTarget([{ full_name: 'A', title: 'Coordinator', persona: 'team_social' }, { full_name: 'B', title: 'Head of Community', persona: 'team_social' }]);
  assert.equal(noWedge.person.full_name, 'B');
  assert.equal(noWedge.fallback, true);
});

test('extractNumbers and unsupportedNumbers: rounding allowed, invented numbers caught', () => {
  assert.deepEqual(extractNumbers('$10.2M, 92%, 1.5M and 70,000+').map((n) => [n.type, n.value]), [['money', 10.2e6], ['pct', 92], ['count', 1.5e6], ['count', 70000]]);
  assert.deepEqual(unsupportedNumbers('Managing 1.5M followers on Instagram', ['1549730']), []);
  assert.deepEqual(unsupportedNumbers('Managing 2M followers', ['1549730']), ['2M']);
  assert.deepEqual(unsupportedNumbers('3 platforms in 2026', []), []);
  assert.deepEqual(unsupportedNumbers('response rate up 60%', ['response rates up 60%']), []);
  assert.deepEqual(unsupportedNumbers('engagement up 75%', ['engagement up 150%']), ['75%']);
});

function goodDraft(evidence, picks) {
  return {
    comments: picks.map((id) => ({ post_id: id, text: 'Love that the briefs leave room for the creator. That is where the real content comes from.', evidence: [id] })),
    own_post: { text: 'Food and beverage brands like Fishwife use Nectar to find creators. At e.l.f. Beauty, DM replies went from 11 hours to 9 minutes.', evidence: ['proof:p9', 'proof:p4'], closest_category_used: 'food and beverage' },
    connection_request: { text: 'Hi Sydney, saw the team is running creators across 811K Instagram followers and 974K on TikTok. Would love to connect.', evidence: ['stat:instagram.followers', 'stat:tiktok.followers'] },
    first_dm: { text: 'Thanks for connecting. Can I send a short Loom on how teams like e.l.f. Beauty cut DM replies from 11 hours to 9 minutes?', evidence: ['proof:p4'] },
    notes_for_ben: '',
  };
}

test('validateDraft: a clean draft passes', () => {
  const b = bundle();
  const candidates = rankCandidates(collectPosts(b), NOW);
  const evidence = buildEvidence({ bundle: b, candidates, playbook });
  const picks = ['post:1', 'post:2', 'post:3'];
  const { problems } = validateDraft(goodDraft(evidence, picks), { evidence, playbook, brandName: b.brand.name, picks });
  assert.deepEqual(problems, []);
});

test('validateDraft: catches a made-up number, unknown id, banned phrase, long note, brand named, uncited customer; fixes em dashes', () => {
  const b = bundle();
  const evidence = buildEvidence({ bundle: b, candidates: rankCandidates(collectPosts(b), NOW), playbook });
  const picks = ['post:1', 'post:2', 'post:3'];
  const d = goodDraft(evidence, picks);
  d.comments[0].text = 'Huge — love this. Engagement up 300% must feel great.';
  d.comments[1].evidence = ['post:99'];
  d.first_dm.text = 'Hope this finds you well. Can I send a Loom?';
  d.connection_request.text = 'x'.repeat(230);
  d.own_post.text = 'Bloom-style brands love creators. Liquid Death too.';
  const { draft, problems } = validateDraft(d, { evidence, playbook, brandName: b.brand.name, picks });
  const issues = problems.map((p) => `${p.where}: ${p.issue}`).join('\n');
  assert.match(issues, /comment 1: numbers not found in the cited sources: 300%/);
  assert.match(issues, /comment 2: cites unknown evidence: post:99/);
  assert.match(issues, /first DM: banned phrase: hope this finds you well/);
  assert.match(issues, /connection request: 230 characters, limit is 200/);
  assert.match(issues, /own post: names the target brand \(Bloom\)/);
  assert.match(issues, /own post: mentions Liquid Death without citing a proof item for Liquid Death/);
  assert.ok(!draft.comments[0].text.includes('—'));
});

// STUB claude: returns queued responses in order and records prompts.
function stubClaude(responses) {
  const calls = [];
  return {
    calls,
    async structured(args) { calls.push(args); const r = responses.shift(); if (!r) throw new Error('no stub response'); return { parsed: typeof r === 'function' ? r(args) : r }; },
    usage: () => ({ costUsd: 0.07, input: 1000, output: 500 }),
  };
}

test('draftEngagement: AI picks 3, drafts, all checks pass on the first try', async () => {
  const b = bundle();
  const claude = stubClaude([
    { picks: [{ post_id: 'post:1', reason: 'Own post with a lesson.' }, { post_id: 'post:2', reason: 'Launch.' }, { post_id: 'post:3', reason: 'Retail win.' }] },
    () => goodDraft(null, ['post:1', 'post:2', 'post:3']),
  ]);
  const r = await draftEngagement({ bundle: b, playbook, claude, now: NOW });
  assert.equal(claude.calls.length, 2);
  assert.deepEqual(r.problems, []);
  assert.equal(r.output.target.name, 'Sydney Specht');
  assert.equal(r.output.picks.length, 3);
  assert.equal(r.output.picks[0].author, 'Emma Price');
  assert.ok(r.output.picks.every((p) => p.comment.text && p.url));
  assert.equal(r.output.connection_request.limit, 200);
  assert.ok(r.output.evidence['proof:p4'].url.includes('nectarsocial.com'));
  assert.equal(r.output.own_post.needs_proof, true, 'food and beverage post carried by a beauty number');
});

test('draftEngagement: Ben\'s swapped picks are kept and Claude fills the rest', async () => {
  const b = bundle();
  const mine = brandPosts[0].url; // Woolworths post
  const claude = stubClaude([
    (args) => {
      assert.match(args.user, /listing the already-chosen ids first: post:1/);
      return { picks: [{ post_id: 'post:1', reason: 'x' }, { post_id: 'post:2', reason: 'Own post.' }, { post_id: 'post:3', reason: 'Launch.' }] };
    },
    goodDraft(null, ['post:1', 'post:2', 'post:3']),
  ]);
  const r = await draftEngagement({ bundle: b, playbook, claude, pickUrls: [mine], now: NOW });
  assert.equal(r.picks[0].url, mine);
  assert.equal(r.picks[0].by, 'ben');
  assert.equal(new Set(r.picks.map((p) => p.url)).size, 3);
});

test('draftEngagement: three picks from Ben skip the pick call entirely', async () => {
  const b = bundle();
  const urls = rankCandidates(collectPosts(b), NOW).slice(2, 5).map((p) => p.url);
  const claude = stubClaude([goodDraft(null, ['post:1', 'post:2', 'post:3'])]);
  const r = await draftEngagement({ bundle: b, playbook, claude, pickUrls: urls, now: NOW });
  assert.equal(claude.calls.length, 1);
  assert.deepEqual(r.picks.map((p) => p.url), urls);
});

test('draftEngagement: a failing draft is retried once with the problems fed back', async () => {
  const b = bundle();
  const bad = goodDraft(null, ['post:1', 'post:2', 'post:3']);
  bad.first_dm = { text: 'We grew engagement 900% for brands like yours.', evidence: ['proof:p6'] };
  const claude = stubClaude([
    { picks: [{ post_id: 'post:1', reason: 'a' }, { post_id: 'post:2', reason: 'b' }, { post_id: 'post:3', reason: 'c' }] },
    bad,
    (args) => { assert.match(args.user, /first DM: numbers not found in the cited sources: 900%/); return goodDraft(null, ['post:1', 'post:2', 'post:3']); },
  ]);
  const r = await draftEngagement({ bundle: b, playbook, claude, now: NOW });
  assert.equal(claude.calls.length, 3);
  assert.deepEqual(r.problems, []);
});

test('draftEngagement: refuses cleanly when there are no recent posts', async () => {
  const b = { ...bundle(), brandPosts: [], stakeholders: bundle().stakeholders.map((s) => ({ ...s, stakeholder_posts: [] })) };
  await assert.rejects(draftEngagement({ bundle: b, playbook, claude: stubClaude([]), now: NOW }), /No posts with text from the last 90 days/);
});
