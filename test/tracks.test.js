import test from 'node:test';
import assert from 'node:assert/strict';
import { seniorityTier, assignTracks, chooseTemplates, templateAdherence, slotValues } from '../server/modules/engagement.js';
import { SEED_PLAYBOOK, DEFAULT_TRACKS, parsePlaybook } from '../server/playbook.js';
import { detectIndustry, rankCaseStudies } from '../shared/caseStudies.js';

// Real titles from the Bloom, Alani Nu and Monster runs.
test('seniorityTier: real titles', () => {
  const cases = {
    'Chief Marketing Officer: EMEA & OSP': 1, 'VP of Marketing': 1, 'SVP, Brand': 1,
    'Director of Social Media': 2, 'Director of Influencer Marketing': 2, 'Head of Influencer Marketing': 2,
    'Director of Social Media, Influencer, and Collegiate Marketing': 2, 'AVP, Community Activation & Growth': 2,
    'Canadian Community Manager Lead': 3, 'Senior Manager, Social Media': 3, 'Social Media Manager-Gaming': 3,
    'Associate Manager, Social Media Marketing': 3, 'Influencer Marketing Specialist': 3, 'Influencer Marketing Coordinator': 3,
  };
  for (const [title, tier] of Object.entries(cases)) assert.equal(seniorityTier(title), tier, title);
});

const person = (id, title) => ({ id, full_name: `P ${id}`, title });
const o = (p, role = 'wedge') => ({ person: p, role });

test('assignTracks: with a CMO found, only C-suite/VP get the PDF; directors and managers get Looms', () => {
  const cmo = person('a', 'Chief Marketing Officer'); const dir = person('b', 'Director of Social Media'); const mgr = person('c', 'Social Media Manager');
  const r = assignTracks([cmo, dir, mgr], [o(cmo), o(dir, 'bridge'), o(mgr, 'bridge')]);
  assert.deepEqual(r.map((x) => x.track), ['pdf', 'loom', 'loom']);
  assert.match(r[1].track_reason, /Below the top tier \(a C-suite or VP was found\)/);
});

test('assignTracks: no C-suite found, so the director is the top tier and gets the PDF', () => {
  const dir = person('b', 'Director of Influencer Marketing'); const head = person('d', 'Head of Influencer Marketing'); const mgr = person('c', 'Influencer Marketing Manager');
  const r = assignTracks([dir, head, mgr], [o(dir), o(head, 'bridge'), o(mgr, 'bridge')]);
  assert.deepEqual(r.map((x) => x.track), ['pdf', 'pdf', 'loom'], 'both tier-2 people are the top tier');
  assert.match(r[0].track_reason, /Most senior person found/);
});

test('chooseTemplates: each person gets a note and DM from their OWN track, rotating, never mixed', () => {
  const people = [{ track: 'pdf' }, { track: 'loom' }, { track: 'loom' }, { track: 'pdf' }];
  const r = chooseTemplates(people, DEFAULT_TRACKS);
  for (const x of r) {
    assert.ok(DEFAULT_TRACKS[x.track].connection_notes.includes(x.templates.connection));
    assert.ok(DEFAULT_TRACKS[x.track].first_dms.includes(x.templates.first_dm));
    assert.equal(/Loom/.test(x.templates.connection), x.track === 'loom');
    assert.equal(/Loom/.test(x.templates.first_dm), x.track === 'loom');
  }
  assert.notEqual(r[1].templates.connection, r[2].templates.connection, 'rotates within a track');
  const noPosts = chooseTemplates([{ track: 'loom' }, { track: 'loom' }], DEFAULT_TRACKS, { hasPosts: false });
  assert.ok(noPosts.every((x) => !/recent launch/.test(x.templates.connection)), 'no post-dependent templates without posts');
});

test('templateAdherence: filled template passes; a reworded one fails', () => {
  const t = DEFAULT_TRACKS.pdf.connection_notes[0];
  const filled = 'Hi Sydney, 1.8M followers across Instagram and TikTok is a big responsibility. Could I share a short resource on how we work with beverage brands like Liquid Death and OLIPOP?';
  assert.equal(templateAdherence(t, filled), true);
  assert.equal(templateAdherence(t, filled.replace('is a big responsibility', 'is huge')), false);
  assert.equal(templateAdherence(t, filled.replace('Could I share a short resource', 'Can I share a 1-minute Loom')), false, 'a Loom offer cannot pass as the PDF template');
});

test('categories: Monster reads as beverage; Fishwife is adjacent, not same space', () => {
  const monster = { brand: { name: 'Monster Energy' }, profile: { summary: [{ text: 'Monster sells energy drinks worldwide and its social team runs gaming and music content.' }], facts: [] } };
  const ind = detectIndustry(monster);
  assert.equal(ind.key, 'beverage');
  const ranked = rankCaseStudies(SEED_PLAYBOOK.proof, ind.key);
  const by = Object.fromEntries(ranked.map((c) => [c.customer, c]));
  assert.equal(by['Liquid Death'].match, true);
  assert.equal(by['OLIPOP'].match, true);
  assert.equal(by['Fishwife'].match, false);
  assert.equal(by['Fishwife'].adjacent, true);
  const v = slotValues({ brand: { name: 'Monster Energy' }, profile: monster.profile, social: [{ platform: 'instagram', followers: 27000000 }, { platform: 'tiktok', followers: 13400000 }, { platform: 'linkedin', followers: 500000 }] }, { full_name: 'Jane Doe' }, SEED_PLAYBOOK);
  assert.equal(v.customers_in_their_space, 'Liquid Death and OLIPOP');
  assert.equal(v.total_followers, '40.4M', 'Instagram + TikTok, LinkedIn excluded');
  assert.equal(v.platforms, 'Instagram and TikTok');
  assert.equal(v.first_name, 'Jane');
});

test('an old Playbook saved before tracks existed still parses, with default tracks', () => {
  const old = structuredClone(SEED_PLAYBOOK); delete old.tracks; delete old.rules.dm_cta;
  const pb = parsePlaybook(old);
  assert.equal(pb.tracks.pdf.first_dms.length, 2);
  assert.match(pb.rules.dm_cta, /15 minutes/);
});
