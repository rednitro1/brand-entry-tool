import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mapCompanyPost } from '../server/modules/linkedinPosts.js';
import {
  collectPosts, rankCandidates, buildPool, chooseTarget, planOutreach, buildSequence, buildEvidence, extractNumbers, unsupportedNumbers, validateDraft, draftEngagement,
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

// person:1 = Sydney (wedge), person:2 = Emma (team).
function goodDraft(evidence, picks, outreach = ['person:1', 'person:2']) {
  return {
    comments: picks.map((id) => ({ post_id: id, text: 'Love that the briefs leave room for the creator. That is where the real content comes from.', evidence: [id] })),
    own_post: { text: 'Food and beverage brands like Fishwife use Nectar to find creators. At e.l.f. Beauty, DM replies went from 11 hours to 9 minutes.', evidence: ['proof:p9', 'proof:p4'], closest_category_used: 'food and beverage' },
    connections: outreach.map((pid) => ({ person_id: pid, text: pid === 'person:1'
      ? 'Hi Sydney, saw the team is running creators across 811K Instagram followers and 974K on TikTok. Would love to connect.'
      : 'Hi Emma, enjoyed your creator summit recap. Would love to connect.', evidence: pid === 'person:1' ? ['stat:instagram.followers', 'stat:tiktok.followers'] : ['person:2'] })),
    first_dm: { text: 'Thanks for connecting. Can I send a short Loom on how teams like e.l.f. Beauty cut DM replies from 11 hours to 9 minutes?', evidence: ['proof:p4'] },
    notes_for_ben: '',
  };
}

test('validateDraft: a clean draft passes', () => {
  const b = bundle();
  const candidates = rankCandidates(collectPosts(b), NOW);
  const evidence = buildEvidence({ bundle: b, candidates, playbook });
  const picks = ['post:1', 'post:2', 'post:3'];
  const { problems } = validateDraft(goodDraft(evidence, picks), { evidence, playbook, brandName: b.brand.name, picks, outreach: ['person:1', 'person:2'] });
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
  d.connections[1].text = 'x'.repeat(230);
  d.connections.push({ person_id: 'person:9', text: 'hi', evidence: ['person:1'] });
  d.own_post.text = 'Bloom-style brands love creators. Liquid Death too.';
  const { draft, problems } = validateDraft(d, { evidence, playbook, brandName: b.brand.name, picks, outreach: ['person:1', 'person:2'] });
  const issues = problems.map((p) => `${p.where}: ${p.issue}`).join('\n');
  assert.match(issues, /comment 1: numbers not found in the cited sources: 300%/);
  assert.match(issues, /comment 2: cites unknown evidence: post:99/);
  assert.match(issues, /first DM: banned phrase: hope this finds you well/);
  assert.match(issues, /connection request to Emma Price: 230 characters, limit is 200/);
  assert.match(issues, /note for person:9, who is not on the outreach list/);
  assert.match(issues, /own post: names the target brand \(Bloom\)/);
  assert.match(issues, /own post: mentions Liquid Death without citing a proof item for Liquid Death/);
  assert.ok(!draft.comments[0].text.includes('—'));
});

// STUB claude: returns queued responses in order and records prompts. A function
// response gets the call args (to answer from the prompt).
function stubClaude(responses) {
  const calls = [];
  return {
    calls,
    async structured(args) { calls.push(args); const r = responses.shift(); if (!r) throw new Error('no stub response'); return { parsed: typeof r === 'function' ? r(args) : r }; },
    usage: () => ({ costUsd: 0.07, input: 1000, output: 500 }),
  };
}

// Writes a valid draft for whatever the prompt asks: one comment per picked post id, one
// connection note per outreach person id.
function draftFromPrompt({ user }) {
  const picked = (user.split('OTHER POSTS')[0].split('PICKED POSTS')[1].match(/\[post:\d+\]/g) || []).map((x) => x.slice(1, -1));
  const people = (user.split('PICKED POSTS')[0].match(/\[person:\d+\]/g) || []).map((x) => x.slice(1, -1));
  const d = goodDraft(null, picked, people);
  return d;
}

test('pools: fewer than 3 recent posts are topped up with older ones, marked older', () => {
  const posts = [
    { url: 'a', posted_at: '2026-09-23T00:00:00Z', text: 'x'.repeat(80), source: 'team', is_repost: false },
    { url: 'b', posted_at: '2026-05-18T00:00:00Z', text: 'y'.repeat(80), source: 'team', is_repost: false },
    { url: 'c', posted_at: '2026-03-17T00:00:00Z', text: 'z'.repeat(80), source: 'wedge', is_repost: false },
    { url: 'd', posted_at: '2025-06-01T00:00:00Z', text: 'w'.repeat(80), source: 'wedge', is_repost: false },
  ];
  const pool = buildPool(posts, NOW);
  assert.deepEqual(pool.map((p) => p.url), ['a', 'c', 'b']);
  assert.equal(pool[0].older, false);
  assert.ok(pool.slice(1).every((p) => p.older && p.age_days > 90));
});

test('planOutreach + buildSequence: wedge always first; commented team members become bridges', () => {
  const people = bundle().stakeholders;
  const emmaPost = { source: 'team', stakeholder_id: 's2', author: 'Emma Price' };
  const brandPost = { source: 'brand', stakeholder_id: null, author: 'Bloom' };
  const o = planOutreach(people, [emmaPost, brandPost]);
  assert.deepEqual(o.map((x) => [x.person.full_name, x.role]), [['Sydney Specht', 'wedge'], ['Emma Price', 'bridge']]);
  assert.deepEqual(buildSequence({ brandName: 'Bloom', pickedPosts: [emmaPost, brandPost], outreach: o }), [
    "Comment on Emma Price's post", "Comment on Bloom's LinkedIn page post",
    'Connect with Emma Price (you commented on their post)', 'Connect with Sydney Specht', 'When Sydney Specht accepts, send the first DM',
  ]);
  assert.deepEqual(planOutreach(people, [brandPost]).map((x) => x.role), ['wedge'], 'brand page posts never create a bridge');
  const kira = { source: 'wedge', stakeholder_id: 's1', author: 'Sydney Specht' };
  assert.equal(buildSequence({ brandName: 'Bloom', pickedPosts: [kira, kira, brandPost], outreach: planOutreach(people, [kira]) })[0], "Comment on Sydney Specht's 2 posts");
});

test('draftEngagement (Alani shape): one recent team post + older posts; bridge and wedge both get notes, wedge gets the DM', async () => {
  const b = { ...bundle(), brandPosts: [] };
  b.stakeholders[1].stakeholder_posts = [
    { url: 'https://www.linkedin.com/posts/emma-a', posted_at: '2026-09-23T10:00:00Z', text: 'Our creator summit wrapped with forty creators and the best briefs left room for their voice.', is_repost: false, reactions: 50, comments: 4 },
    { url: 'https://www.linkedin.com/posts/emma-b', posted_at: '2026-05-18T10:00:00Z', text: 'Proud of the team for the spring launch, our biggest creator activation so far this year.', is_repost: false, reactions: 80, comments: 9 },
  ];
  b.stakeholders[0].stakeholder_posts = [
    { url: 'https://www.linkedin.com/posts/sydney-a', posted_at: '2026-03-17T10:00:00Z', text: 'Spoke on a panel about influencer programs that scale without losing the community feel.', is_repost: false, reactions: 120, comments: 12 },
  ];
  const claude = stubClaude([draftFromPrompt]);
  const r = await draftEngagement({ bundle: b, playbook, claude, now: NOW });
  assert.equal(claude.calls.length, 1, 'exactly 3 candidates: no pick call');
  assert.equal(r.output.picks.length, 3);
  assert.equal(r.output.picks.filter((p) => p.older).length, 2);
  assert.ok(r.output.picks.filter((p) => p.older).every((p) => /Fewer than 3 posts in the last 3 months/.test(p.reason)));
  assert.deepEqual(r.output.outreach.map((o) => [o.name, o.role, Boolean(o.dm)]), [['Sydney Specht', 'wedge', true], ['Emma Price', 'bridge', false]]);
  assert.ok(r.output.outreach.every((o) => o.connection.text && o.connection.limit === 200));
  assert.equal(r.output.sequence.at(-1), 'When Sydney Specht accepts, send the first DM');
  assert.deepEqual(r.problems, []);
});

test('draftEngagement: a single post still gives a full plan', async () => {
  const b = { ...bundle(), brandPosts: [] };
  b.stakeholders[1].stakeholder_posts = [b.stakeholders[1].stakeholder_posts[1]];
  const claude = stubClaude([draftFromPrompt]);
  const r = await draftEngagement({ bundle: b, playbook, claude, now: NOW });
  assert.equal(r.output.picks.length, 1);
  assert.match(r.output.picks[0].reason, /One of only 1 post/);
  assert.equal(r.output.outreach.length, 2);
  assert.ok(r.output.own_post.text && r.output.outreach[0].dm.text);
});

test('draftEngagement: no posts at all still drafts own post, connection note and DM (no comments)', async () => {
  const b = { ...bundle(), brandPosts: [], stakeholders: bundle().stakeholders.map((s) => ({ ...s, stakeholder_posts: [] })) };
  const claude = stubClaude([(args) => { assert.match(args.user, /none: there are no posts with text from the past year/); return draftFromPrompt(args); }]);
  const r = await draftEngagement({ bundle: b, playbook, claude, now: NOW });
  assert.equal(r.output.picks.length, 0);
  assert.deepEqual(r.output.outreach.map((o) => o.role), ['wedge']);
  assert.equal(r.output.brand_posts_pulled, false);
  assert.deepEqual(r.problems, []);
});

test('draftEngagement: many candidates, AI picks; bad or duplicate ids are filled from the ranked order', async () => {
  const b = bundle();
  const claude = stubClaude([
    { picks: [{ post_id: 'post:99', reason: 'bad id' }, { post_id: 'post:2', reason: 'Launch.' }, { post_id: 'post:2', reason: 'dupe' }] },
    draftFromPrompt,
  ]);
  const r = await draftEngagement({ bundle: b, playbook, claude, now: NOW });
  assert.equal(claude.calls.length, 2);
  assert.equal(r.output.picks.length, 3);
  assert.equal(new Set(r.output.picks.map((p) => p.url)).size, 3);
  assert.equal(r.output.picks[0].reason, 'Launch.');
  assert.deepEqual(r.problems, []);
});

test('draftEngagement: a failed pick call falls back to the ranked order instead of failing', async () => {
  const claude = stubClaude([() => { throw new Error('model declined'); }, draftFromPrompt]);
  const r = await draftEngagement({ bundle: bundle(), playbook, claude, now: NOW });
  assert.equal(r.output.picks.length, 3);
});

test('draftEngagement: Ben\'s picks are kept first and the AI fills the rest', async () => {
  const mine = brandPosts[0].url;
  const claude = stubClaude([(args) => { assert.match(args.user, /Pick exactly 2 posts/); return { picks: [{ post_id: 'post:2', reason: 'Own post.' }, { post_id: 'post:3', reason: 'Launch.' }] }; }, draftFromPrompt]);
  const r = await draftEngagement({ bundle: bundle(), playbook, claude, pickUrls: [mine], now: NOW });
  assert.equal(r.picks[0].url, mine);
  assert.equal(r.picks[0].by, 'ben');
  assert.equal(new Set(r.picks.map((p) => p.url)).size, 3);
});

test('draftEngagement: a failing draft is retried once with the problems fed back', async () => {
  const claude = stubClaude([
    { picks: [{ post_id: 'post:1', reason: 'a' }, { post_id: 'post:2', reason: 'b' }, { post_id: 'post:3', reason: 'c' }] },
    (args) => { const d = draftFromPrompt(args); d.first_dm = { text: 'We grew engagement 900% for brands like yours.', evidence: ['proof:p6'] }; return d; },
    (args) => { assert.match(args.user, /first DM: numbers not found in the cited sources: 900%/); return draftFromPrompt(args); },
  ]);
  const r = await draftEngagement({ bundle: bundle(), playbook, claude, now: NOW });
  assert.equal(claude.calls.length, 3);
  assert.deepEqual(r.problems, []);
});
