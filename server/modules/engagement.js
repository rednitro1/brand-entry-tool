import { z } from 'zod';
import { PERSONAS, PERSONA_LABEL } from './stakeholders.js';
import { withinDays } from './linkedinPosts.js';

/* Part 2: the warm-up + first touch. Picks three posts to engage with, then drafts a
   comment for each, one post for Ben's own page, a connection request and a first DM.
   It only RECOMMENDS: the UI offers copy buttons, nothing here posts or connects.

   Every input gets an id (post:3, fact:f2, stat:instagram.followers, proof:p1, person:2)
   and every draft must cite the ids it relies on. The server then checks the ids exist,
   the numbers in the copy come from the cited items, banned phrases and em dashes are
   absent, the connection note fits, and the own post never names the target brand. */

const WEDGE = new Set(['cmo', 'director_social', 'chief_digital', 'director_cx']);
const MIN_TEXT = 40;
const MAX_CANDIDATES = 15;

/* ------------------------------- candidates -------------------------------- */

/* Person posts (their own and reposts) plus the brand page's posts, one list. */
export function collectPosts(bundle) {
  const out = [];
  for (const s of bundle.stakeholders || []) {
    for (const p of s.stakeholder_posts || []) {
      out.push({
        url: p.url, posted_at: p.posted_at, text: p.text || '', is_repost: Boolean(p.is_repost),
        reactions: p.reactions, comments: p.comments,
        source: WEDGE.has(s.persona) ? 'wedge' : 'team',
        author: s.full_name, author_title: s.title, persona: s.persona, stakeholder_id: s.id,
      });
    }
  }
  for (const p of bundle.brandPosts || []) {
    out.push({
      url: p.url, posted_at: p.posted_at, text: p.caption || '', is_repost: Boolean(p.is_repost),
      reactions: p.likes, comments: p.comments,
      source: 'brand', author: p.author || bundle.brand?.name, author_title: 'Brand LinkedIn page', persona: null, stakeholder_id: null,
    });
  }
  // The same brand post often shows up as a team member's repost; keep one copy.
  const seen = new Map();
  for (const p of out) {
    const prev = seen.get(p.url);
    if (!prev || rankSource(p) > rankSource(prev)) seen.set(p.url, p);
  }
  return [...seen.values()];
}

const SOURCE_WEIGHT = { wedge: 3, team: 2, brand: 1 };
const rankSource = (p) => SOURCE_WEIGHT[p.source] + (p.is_repost ? 0 : 0.5);

/* Rank posts with real text inside a window of days ago [fromDays, toDays): wedge
   persona first, then team, then brand page; own posts above reposts; then recency and
   engagement. */
export function rankCandidates(posts, now = new Date(), { fromDays = 0, toDays = 90 } = {}) {
  return posts
    .filter((p) => {
      if (!p.posted_at || p.text.trim().length < MIN_TEXT) return false;
      const age = (now - new Date(p.posted_at)) / 864e5;
      return age >= fromDays && age < toDays;
    })
    .map((p) => {
      const ageDays = Math.round((now - new Date(p.posted_at)) / 864e5);
      const recency = 1 - ageDays / toDays;
      const engagement = Math.log10(1 + (p.reactions || 0) + 3 * (p.comments || 0)) / 4; // ~0..1
      return { ...p, age_days: ageDays, older: ageDays >= 90, score: SOURCE_WEIGHT[p.source] + (p.is_repost ? 0 : 0.75) + recency + engagement };
    })
    .sort((a, b) => b.score - a.score);
}

/* What the picks come from: the last 3 months first; if that gives fewer than 3, top up
   with the best posts from up to 12 months back (each marked older). Never empty by
   rule: an account with no posts at all simply gets no comments. */
export function buildPool(posts, now = new Date()) {
  const recent = rankCandidates(posts, now, { fromDays: 0, toDays: 90 });
  if (recent.length >= 3) return recent;
  return [...recent, ...rankCandidates(posts, now, { fromDays: 90, toDays: 365 })];
}

/* Who gets the connection request and DM: the most senior wedge persona found, even if
   they never post (Ben's rule). Falls back to the most senior team member, flagged. */
export function chooseTarget(stakeholders = []) {
  for (const persona of PERSONAS) {
    const hit = stakeholders.find((s) => s.persona === persona);
    if (hit) return { person: hit, fallback: false };
  }
  const senior = /\b(chief|vp|vice president|head|director|lead)\b/i;
  const team = [...stakeholders].sort((a, b) => Number(senior.test(b.title || '')) - Number(senior.test(a.title || '')));
  return team[0] ? { person: team[0], fallback: true } : { person: null, fallback: true };
}

/* ------------------------------- evidence index ------------------------------ */

const fmtNum = (n) => Number(n).toLocaleString('en-US');

/* Every citable thing, keyed by the id the model must cite. */
export function buildEvidence({ bundle, candidates, playbook }) {
  const ev = {};
  candidates.forEach((p, i) => {
    ev[`post:${i + 1}`] = {
      kind: 'post', url: p.url, label: `${p.author}${p.is_repost ? ' (repost)' : ''}, ${p.posted_at?.slice(0, 10)}`,
      text: p.text, numbers_text: `${p.text} ${p.reactions ?? ''} reactions ${p.comments ?? ''} comments`, post: p,
    };
  });
  for (const f of bundle.profile?.facts || []) {
    ev[`fact:${f.id}`] = { kind: 'fact', url: f.url, label: f.claim?.slice(0, 90), text: `${f.claim} (quote: ${f.quote})`, numbers_text: `${f.claim} ${f.quote}` };
  }
  const PNAME = { instagram: 'Instagram', tiktok: 'TikTok', x: 'X', linkedin: 'LinkedIn' };
  const withStats = [];
  for (const s of bundle.social || []) {
    if (s.followers === null || s.followers === undefined) continue;
    withStats.push(s.platform);
    ev[`stat:${s.platform}.followers`] = { kind: 'stat', url: s.url, label: `${PNAME[s.platform]} followers`, text: `${PNAME[s.platform]} @${s.handle}: ${fmtNum(s.followers)} followers`, numbers_text: String(s.followers) };
    if (s.post_count) ev[`stat:${s.platform}.posts`] = { kind: 'stat', url: s.url, label: `${PNAME[s.platform]} posts`, text: `${PNAME[s.platform]}: ${fmtNum(s.post_count)} posts`, numbers_text: String(s.post_count) };
  }
  if (withStats.length) {
    const total = (bundle.social || []).reduce((t, s) => t + (s.platform !== 'linkedin' ? Number(s.followers || 0) : 0), 0);
    ev['stat:platforms'] = {
      kind: 'stat', url: null, label: 'Platforms with stats',
      text: `${withStats.length} platforms with public follower counts (${withStats.map((p) => PNAME[p]).join(', ')}); ${fmtNum(total)} followers across Instagram, TikTok and X combined`,
      numbers_text: `${withStats.length} ${total}`,
    };
  }
  (bundle.stakeholders || []).forEach((s, i) => {
    ev[`person:${i + 1}`] = {
      kind: 'person', url: s.linkedin_url, label: s.full_name,
      text: `${s.full_name}, ${s.title}${s.tenure_months ? `, ${s.tenure_months} months in role` : ''}`,
      numbers_text: `${s.tenure_months ?? ''}`, stakeholder_id: s.id,
    };
  });
  for (const p of playbook.proof || []) {
    ev[`proof:${p.id}`] = { kind: 'proof', url: p.source_url, label: `${p.customer}: ${p.claim.slice(0, 70)}`, text: `${p.customer} (${p.category}): ${p.claim}`, numbers_text: p.claim, customer: p.customer, category: p.category };
  }
  return ev;
}

/* --------------------------------- numbers --------------------------------- */

/* Numbers as written in copy or sources: 1,549,730 / 1.5M / $10.2M / 92% / 70,000+. */
export function extractNumbers(text) {
  const out = [];
  const re = /(\$)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(%|[kKmMbB](?![a-zA-Z])|x(?![a-zA-Z]))?/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    let v = Number(m[2].replace(/,/g, ''));
    const suf = (m[3] || '').toLowerCase();
    if (suf === 'k') v *= 1e3; else if (suf === 'm') v *= 1e6; else if (suf === 'b') v *= 1e9;
    out.push({ raw: m[0].trim(), value: v, type: m[1] ? 'money' : suf === '%' ? 'pct' : 'count' });
  }
  return out;
}

/* A number in the copy is supported if a cited item has the same kind of number within
   5% (so 1,549,730 may be written 1.5M). Small counts (<= 12, e.g. "3 platforms") and
   years are allowed without a source. */
export function unsupportedNumbers(copy, sourceTexts) {
  const src = sourceTexts.flatMap(extractNumbers);
  return extractNumbers(copy).filter((n) => {
    if (n.type === 'count' && (n.value <= 12 || (n.value >= 2000 && n.value <= 2035 && Number.isInteger(n.value)))) return false;
    return !src.some((s) => s.type === n.type && Math.abs(s.value - n.value) <= 0.05 * Math.max(Math.abs(s.value), 1));
  }).map((n) => n.raw);
}

/* -------------------------------- validator -------------------------------- */

const brandWords = (name) => String(name || '')
  .replace(/\b(llc|inc|co|corp|ltd|company|nutrition|beverages?|foods?|brands?)\b\.?/gi, '')
  .split(/\s+/).map((w) => w.trim()).filter((w) => w.length >= 3);

/* Returns { draft (em dashes fixed), problems: [{ where, issue }] }. outreach: the person
   ids (person:N) that must each get exactly one connection note. */
export function validateDraft(draft, { evidence, playbook, brandName, picks = [], outreach = [] }) {
  const problems = [];
  const fix = (s) => String(s || '').replace(/\s*—\s*/g, ', ').replace(/\s+–\s+/g, ' - ');
  const banned = (playbook.banned || []).map((b) => b.toLowerCase());
  const customers = (playbook.proof || []).filter((p) => p.kind !== 'company').map((p) => p.customer);

  const check = (where, item, { maxChars = null, requireEvidence = true } = {}) => {
    if (!item) { problems.push({ where, issue: 'missing' }); return; }
    if (/[—]/.test(item.text)) item.text = fix(item.text);
    const ids = item.evidence || [];
    const unknown = ids.filter((id) => !evidence[id]);
    if (unknown.length) problems.push({ where, issue: `cites unknown evidence: ${unknown.join(', ')}` });
    if (requireEvidence && ids.filter((id) => evidence[id]).length === 0) problems.push({ where, issue: 'no evidence cited' });
    const sources = ids.filter((id) => evidence[id]).map((id) => evidence[id].numbers_text || evidence[id].text);
    const bad = unsupportedNumbers(item.text, sources);
    if (bad.length) problems.push({ where, issue: `numbers not found in the cited sources: ${bad.join(', ')}` });
    const low = item.text.toLowerCase();
    const hits = banned.filter((b) => low.includes(b));
    if (hits.length) problems.push({ where, issue: `banned phrase: ${hits.join(', ')}` });
    if (maxChars && item.text.length > maxChars) problems.push({ where, issue: `${item.text.length} characters, limit is ${maxChars}` });
    for (const c of customers) {
      if (new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(item.text)
        && !ids.some((id) => evidence[id]?.kind === 'proof' && evidence[id].customer === c)) {
        problems.push({ where, issue: `mentions ${c} without citing a proof item for ${c}` });
      }
    }
  };

  (draft.comments || []).forEach((c, i) => {
    check(`comment ${i + 1}`, c);
    if (!picks.includes(c.post_id)) problems.push({ where: `comment ${i + 1}`, issue: `is for ${c.post_id}, which is not one of the picked posts` });
  });
  if ((draft.comments || []).length !== picks.length) problems.push({ where: 'comments', issue: `expected ${picks.length} comments, got ${(draft.comments || []).length}` });
  check('own post', draft.own_post);
  if (draft.own_post) {
    const named = brandWords(brandName).filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(draft.own_post.text));
    if (named.length) problems.push({ where: 'own post', issue: `names the target brand (${named.join(', ')})` });
  }
  const limit = playbook.rules?.connection_note_max || 200;
  for (const pid of outreach) {
    const notes = (draft.connections || []).filter((c) => c.person_id === pid);
    const who = evidence[pid]?.label || pid;
    if (notes.length === 0) problems.push({ where: `connection request to ${who}`, issue: 'missing' });
    else if (notes.length > 1) problems.push({ where: `connection request to ${who}`, issue: `${notes.length} notes, expected one` });
    if (notes[0]) check(`connection request to ${who}`, notes[0], { maxChars: limit });
  }
  for (const c of draft.connections || []) {
    if (!outreach.includes(c.person_id)) problems.push({ where: 'connection requests', issue: `note for ${c.person_id}, who is not on the outreach list` });
  }
  check('first DM', draft.first_dm);
  return { draft, problems };
}

/* --------------------------------- prompts --------------------------------- */

const PickSchema = z.object({
  picks: z.array(z.object({ post_id: z.string(), reason: z.string() })),
});

const Item = z.object({ text: z.string(), evidence: z.array(z.string()) });
const DraftSchema = z.object({
  comments: z.array(z.object({ post_id: z.string(), text: z.string(), evidence: z.array(z.string()) })),
  own_post: z.object({ text: z.string(), evidence: z.array(z.string()), closest_category_used: z.string() }),
  connections: z.array(z.object({ person_id: z.string(), text: z.string(), evidence: z.array(z.string()) })),
  first_dm: Item,
  notes_for_ben: z.string(),
});

function playbookBlock(pb) {
  const ex = pb.examples || {};
  const list = (arr) => (arr || []).map((x) => `- ${x}`).join('\n');
  const exBlock = (title, arr) => (arr?.length ? `\n${title} (match this style closely):\n${arr.map((x, i) => `[${i + 1}] ${x}`).join('\n\n')}` : '');
  return `SENDER: ${pb.sender.name}, ${pb.sender.role}${pb.sender.headline ? ` (${pb.sender.headline})` : ''}

WHAT NECTAR SELLS:
${pb.product.one_liner}
Value props:
${list(pb.product.value_props)}
Who it's for: ${pb.product.who_its_for}
Pains it solves:
${list(pb.product.pains)}

VOICE:
${list(pb.voice.tone)}
Words that fit: ${(pb.voice.use || []).join(', ')}

NEVER USE THESE PHRASES: ${(pb.banned || []).join(' | ')}
Never use em dashes.

RULES:
${list(pb.rules.extra)}
- The connection request must be at most ${pb.rules.connection_note_max} characters.
- The first DM offers ${pb.rules.dm_offer}.${exBlock('GOOD COMMENTS', ex.comments)}${exBlock('GOOD CONNECTION NOTES', ex.connection_notes)}${exBlock('GOOD DMS', ex.dms)}${exBlock('GOOD POSTS', ex.posts)}`;
}

const ageText = (p) => (p.older ? ` (${Math.max(3, Math.round(p.age_days / 30))} months old)` : '');

const evidenceLines = (evidence, kinds) => Object.entries(evidence)
  .filter(([, v]) => kinds.includes(v.kind))
  .map(([id, v]) => `[${id}] ${v.kind === 'post' ? `${v.label}${ageText(v.post)} (${v.post.source === 'brand' ? 'brand page' : v.post.source === 'wedge' ? `wedge persona: ${PERSONA_LABEL[v.post.persona]}` : 'team'}; ${v.post.reactions ?? '?'} reactions, ${v.post.comments ?? '?'} comments)\n${v.text.slice(0, 900)}` : v.text}`)
  .join('\n\n');

/* ------------------------------ outreach routing ----------------------------- */

const MAX_BRIDGES = 2;

/* Who gets what. The wedge persona always gets a connection request and the first DM,
   even if they never post. Each non-wedge person whose post we comment on also gets a
   connection request grounded in that post: the bridge we work up through. */
export function planOutreach(stakeholders = [], pickedPosts = []) {
  const { person: wedge, fallback } = chooseTarget(stakeholders);
  const out = [];
  if (wedge) out.push({ person: wedge, role: 'wedge', fallback });
  for (const post of pickedPosts) {
    if (post.source === 'brand' || !post.stakeholder_id) continue;
    if (out.some((o) => o.person.id === post.stakeholder_id)) continue;
    if (out.filter((o) => o.role === 'bridge').length >= MAX_BRIDGES) break;
    const person = stakeholders.find((s) => s.id === post.stakeholder_id);
    if (person) out.push({ person, role: 'bridge', fallback: false });
  }
  return out;
}

/* The week, in order: comments first, then connect with the bridges, then the wedge
   persona, then the DM once they accept. */
export function buildSequence({ brandName, pickedPosts, outreach }) {
  const steps = [];
  // One step per author, in pick order ("Comment on Kira's 2 posts").
  const groups = [];
  for (const p of pickedPosts) {
    const key = p.source === 'brand' ? '__brand' : p.author;
    const g = groups.find((x) => x.key === key);
    if (g) g.n += 1; else groups.push({ key, n: 1 });
  }
  for (const g of groups) {
    const what = g.n === 1 ? 'post' : `${g.n} posts`;
    steps.push(g.key === '__brand' ? `Comment on ${brandName}'s LinkedIn page ${g.n === 1 ? 'post' : what}` : `Comment on ${g.key}'s ${what}`);
  }
  for (const o of outreach.filter((x) => x.role === 'bridge')) steps.push(`Connect with ${o.person.full_name} (you commented on their post)`);
  const wedge = outreach.find((x) => x.role === 'wedge');
  if (wedge) {
    steps.push(`Connect with ${wedge.person.full_name}`);
    steps.push(`When ${wedge.person.full_name} accepts, send the first DM`);
  }
  return steps;
}

/* --------------------------------- prompts --------------------------------- */

const PICK_SYSTEM = `You help a B2B rep at Nectar Social warm up a target account on LinkedIn. You choose which posts are worth engaging with this week. You only recommend; nothing is posted automatically.

Choose the requested number of posts from the candidate list. Prefer, in order: posts by the wedge persona, then their team, then the brand page. Prefer recent posts and posts with something specific to react to (a launch, a lesson, a result, a team moment) over generic promos. Older posts are marked with their age; use them only if they are clearly better. Use only post ids from the list. Give a one-sentence reason for each that names what in the post makes it worth a comment.`;

const DRAFT_SYSTEM = (pb) => `You write LinkedIn warm-up copy for a rep at Nectar Social, in the first person as the sender below. You only recommend: a human copies and sends everything by hand.

${playbookBlock(pb)}

WHAT TO WRITE:
1. comments: one per picked post (same post_id), and none if there are no picked posts. React to what the post actually says, in 1 to 3 sentences. Sound like a peer who works in social, add a real observation or question. No pitch, no Nectar mention, no links, no flattery-only comments. If a post is months old, write as someone catching up on it, not as if it were new.
2. own_post: a LinkedIn post for the sender's own page this week. It must NOT name or tag the target brand or its people. Its job is credibility: when people at the account look at the sender's profile, they see Nectar working with brands like theirs and the results. Use ONLY results from proof items, credit each number to the customer it belongs to, and prefer customers in the target's category. If no proof item in the target's category has a number, say what brands in that category use Nectar for (from proof items) and use numbers only from other named customers, clearly credited. Set closest_category_used to the proof category you leaned on.
3. connections: exactly one connection note per person on the OUTREACH list (person_id = their person id), each at most the character limit, no pitch.
   - A BRIDGE is a team member whose post you are commenting on. Their note references that post specifically.
   - The WEDGE persona is who the deal runs through. Their note is grounded in one specific thing about their world: their own post if one was picked, otherwise their team's recent activity, the brand's page stats or a brand fact. Do not pretend they posted something they did not.
4. first_dm: to the WEDGE persona, sent after they accept. Structure: (a) a specific opener from the research about what their team is handling (e.g. follower counts across platforms, a launch or campaign their team posted about), never generic congratulations; (b) offer the Loom; (c) one proof point from a similar brand, credited; (d) Nectar's value in one plain sentence. Short paragraphs, under 110 words.

EVIDENCE: every item lists the evidence ids it relies on (post:, fact:, stat:, person:, proof:). Any number you write must appear in an item you cite (rounding like 1,549,730 to 1.5M is fine). Do not state anything about the brand, the people or Nectar that is not in the cited evidence. If something would make the copy better but is not in the evidence, leave it out and mention it in notes_for_ben.`;

/* --------------------------------- drafting -------------------------------- */

/* bundle: getBrandBundle output. pickUrls: Ben's chosen post URLs (0..3; the AI fills the
   rest). Always returns a plan: with fewer posts it comments on fewer, with none it still
   drafts the own post, connection notes and the DM. */
export async function draftEngagement({ bundle, playbook, claude, pickUrls = [], log = () => {}, now = new Date() }) {
  const all = collectPosts(bundle);
  const pool = buildPool(all, now);
  const forced = pickUrls.map((u) => all.find((p) => p.url === u)).filter(Boolean)
    .map((p) => ({ ...p, age_days: Math.round((now - new Date(p.posted_at)) / 864e5), older: (now - new Date(p.posted_at)) / 864e5 >= 90 }));
  const candidates = [...forced, ...pool.filter((p) => !forced.some((f) => f.url === p.url))].slice(0, Math.max(MAX_CANDIDATES, forced.length));
  if (!(bundle.stakeholders || []).length) throw new Error('No stakeholders found to address the outreach to. Run the research again.');

  const evidence = buildEvidence({ bundle, candidates, playbook });
  const idOf = (url) => Object.entries(evidence).find(([, v]) => v.kind === 'post' && v.url === url)?.[0];
  const want = Math.min(3, candidates.length);
  log(`${candidates.length} candidate posts (${candidates.filter((p) => p.older).length} older than 3 months); picking ${want}`);

  // Step 1: picks. Ben's swaps first; if what's left fits, take it all (no model call);
  // otherwise Claude chooses, and anything invalid is filled from the ranked order.
  let picks = forced.slice(0, 3).map((p) => ({ post_id: idOf(p.url), reason: 'Picked by you.', by: 'ben' }));
  const rest = candidates.filter((p) => !picks.some((x) => evidence[x.post_id].url === p.url));
  const need = want - picks.length;
  if (need > 0 && rest.length <= need) {
    picks.push(...rest.map((p) => ({
      post_id: idOf(p.url),
      reason: candidates.length < 3 ? `One of only ${candidates.length} post${candidates.length === 1 ? '' : 's'} with text from the past year.`
        : p.older ? `Fewer than 3 posts in the last 3 months, so this is one of the best from earlier in the year.` : 'Best remaining match.',
      by: 'ai',
    })));
  } else if (need > 0) {
    const restEv = Object.fromEntries(Object.entries(evidence).filter(([, v]) => v.kind === 'post' && rest.some((p) => p.url === v.url)));
    const user = `Target brand: ${bundle.brand.name}\n\nCANDIDATE POSTS:\n\n${evidenceLines(restEv, ['post'])}\n\nPick exactly ${need} post${need === 1 ? '' : 's'}.`;
    let chosen = [];
    try {
      const { parsed } = await claude.structured({ system: PICK_SYSTEM, user, schema: PickSchema, effort: 'low', maxTokens: 4000 });
      chosen = parsed.picks.filter((p, i, arr) => restEv[p.post_id] && arr.findIndex((x) => x.post_id === p.post_id) === i).slice(0, need);
    } catch (err) { log(`Pick step failed (${err.message}); using the ranked order`); }
    picks.push(...chosen.map((p) => ({ ...p, by: 'ai' })));
    for (const p of rest) {
      if (picks.length >= want) break;
      const id = idOf(p.url);
      if (!picks.some((x) => x.post_id === id)) picks.push({ post_id: id, reason: 'Next best by recency, author and engagement.', by: 'ai' });
    }
  }
  const pickIds = picks.map((p) => p.post_id);
  const pickedPosts = pickIds.map((id) => evidence[id].post);
  log(pickIds.length ? `Picked: ${pickIds.map((id) => evidence[id].label).join(' | ')}` : 'No posts with text in the past year; drafting outreach without comments');

  // Who to reach: wedge persona (connect + DM) and bridges (connect).
  const outreach = planOutreach(bundle.stakeholders, pickedPosts);
  const personId = (s) => Object.entries(evidence).find(([, v]) => v.kind === 'person' && v.stakeholder_id === s.id)?.[0];
  const outreachIds = outreach.map((o) => personId(o.person));
  const sequence = buildSequence({ brandName: bundle.brand.name, pickedPosts, outreach });
  log(`Outreach: ${outreach.map((o) => `${o.person.full_name} (${o.role})`).join(', ')}`);

  // Step 2: drafts, validated, with one retry that feeds the problems back.
  const outreachLines = outreach.map((o, i) => {
    const post = pickedPosts.find((p) => p.stakeholder_id === o.person.id);
    return `[${outreachIds[i]}] ${o.role.toUpperCase()}: ${o.person.full_name}, ${o.person.title}${o.fallback ? ' (no wedge persona found; most senior team member)' : ''}${post ? ` (you are commenting on their post ${idOf(post.url)})` : o.role === 'wedge' ? ' (no picked post of theirs)' : ''}`;
  }).join('\n');
  const brief = `TARGET BRAND: ${bundle.brand.name}${bundle.brand.domain ? ` (${bundle.brand.domain})` : ''}

OUTREACH (one connection note each; the first DM goes to the WEDGE persona):
${outreachLines}

PICKED POSTS (one comment each):
${pickIds.length ? evidenceLines(Object.fromEntries(pickIds.map((id) => [id, evidence[id]])), ['post']) : '(none: there are no posts with text from the past year, so write no comments)'}

OTHER POSTS (context, citable):
${evidenceLines(Object.fromEntries(Object.entries(evidence).filter(([id, v]) => v.kind === 'post' && !pickIds.includes(id)).slice(0, 8)), ['post']) || '(none)'}

PEOPLE:
${evidenceLines(evidence, ['person'])}

SOCIAL PAGE STATS:
${evidenceLines(evidence, ['stat']) || '(none)'}

BRAND FACTS (receipt-checked):
${evidenceLines(Object.fromEntries(Object.entries(evidence).filter(([, v]) => v.kind === 'fact').slice(0, 25)), ['fact']) || '(none)'}

NECTAR PROOF ITEMS (the only results you may state):
${evidenceLines(evidence, ['proof'])}`;

  const system = DRAFT_SYSTEM(playbook);
  const checks = { evidence, playbook, brandName: bundle.brand.name, picks: pickIds, outreach: outreachIds };
  log(`Drafting ${pickIds.length} comment${pickIds.length === 1 ? '' : 's'}, your post, ${outreach.length} connection request${outreach.length === 1 ? '' : 's'} and the first DM`);
  let { parsed: draft } = await claude.structured({ system, user: brief, schema: DraftSchema, effort: 'medium', maxTokens: 12000 });
  let { problems } = validateDraft(draft, checks);
  if (problems.length) {
    log(`First draft had ${problems.length} problem(s), redrafting once`);
    const retry = `${brief}\n\nYOUR PREVIOUS DRAFT:\n${JSON.stringify(draft)}\n\nIT FAILED THESE CHECKS. Fix every one and keep everything else:\n${problems.map((p) => `- ${p.where}: ${p.issue}`).join('\n')}`;
    ({ parsed: draft } = await claude.structured({ system, user: retry, schema: DraftSchema, effort: 'medium', maxTokens: 12000 }));
    ({ problems } = validateDraft(draft, checks));
  }
  log(problems.length ? `Done with ${problems.length} flagged problem(s)` : 'Done, all checks passed');

  // Needs proof when none of the cited results is from the category the post leans on.
  const needsProof = !(playbook.proof || []).some((p) => p.kind === 'result'
    && draft.own_post.evidence.includes(`proof:${p.id}`) && sameCategory(p.category, draft.own_post.closest_category_used));
  const usedIds = new Set([
    ...draft.comments.flatMap((c) => c.evidence), ...pickIds, ...draft.own_post.evidence,
    ...draft.connections.flatMap((c) => c.evidence), ...draft.first_dm.evidence,
  ]);
  const evidenceIndex = Object.fromEntries([...usedIds].filter((id) => evidence[id]).map((id) => {
    const { kind, url, label, text } = evidence[id];
    return [id, { kind, url, label, text: String(text).slice(0, 500) }];
  }));
  const limit = playbook.rules.connection_note_max;
  const noteFor = (pid) => draft.connections.find((c) => c.person_id === pid) || { text: '', evidence: [] };
  const wedgeIdx = outreach.findIndex((o) => o.role === 'wedge');

  return {
    picks: picks.map((p) => ({ url: evidence[p.post_id].url, reason: p.reason, by: p.by })),
    problems,
    output: {
      version: 2,
      sequence,
      outreach: outreach.map((o, i) => {
        const post = pickedPosts.find((p) => p.stakeholder_id === o.person.id);
        const note = noteFor(outreachIds[i]);
        return {
          name: o.person.full_name, title: o.person.title, persona: o.person.persona, linkedin_url: o.person.linkedin_url,
          role: o.role, fallback: o.fallback,
          why: o.role === 'bridge' ? 'You are commenting on their post, so the connection request has context.'
            : post ? 'Wedge persona, and you are commenting on their post.' : 'Wedge persona: the deal runs through them, even though they have not posted recently.',
          connection: { text: note.text, evidence: note.evidence, chars: note.text.length, limit },
          dm: i === wedgeIdx ? draft.first_dm : null,
        };
      }),
      picks: picks.map((p) => {
        const post = evidence[p.post_id].post;
        const c = draft.comments.find((x) => x.post_id === p.post_id) || { text: '', evidence: [] };
        return {
          post_id: p.post_id, url: post.url, author: post.author, source: post.source, persona: post.persona, posted_at: post.posted_at,
          older: Boolean(post.older), age_days: post.age_days ?? null,
          is_repost: post.is_repost, excerpt: post.text.slice(0, 400), reactions: post.reactions, comments: post.comments,
          reason: p.reason, by: p.by, comment: { text: c.text, evidence: c.evidence },
        };
      }),
      own_post: { ...draft.own_post, needs_proof: needsProof },
      notes_for_ben: draft.notes_for_ben,
      problems,
      evidence: evidenceIndex,
      playbook_status: playbook.status,
      brand_posts_pulled: (bundle.brandPosts || []).length > 0,
    },
  };
}

const sameCategory = (a, b) => String(a || '').toLowerCase().split(/[^a-z]+/).some((w) => w.length > 3 && String(b || '').toLowerCase().includes(w));
