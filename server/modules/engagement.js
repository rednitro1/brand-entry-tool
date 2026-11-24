import { z } from 'zod';
import { PERSONAS, PERSONA_LABEL } from './stakeholders.js';
import { withinDays } from './linkedinPosts.js';
import { detectIndustry, rankCaseStudies } from '../../shared/caseStudies.js';
import { isHiringPost } from '../../shared/signals.js';

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

/* The words that identify the brand in its name. Category words ("Beauty" in Fenty
   Beauty, "Energy" in Monster Energy) are left out: an own post may say "beauty brands"
   without naming Fenty. If every word is generic, the full name is the only signal. */
const GENERIC_NAME_WORDS = new Set(['llc', 'inc', 'co', 'corp', 'ltd', 'company', 'the', 'and', 'brand', 'brands',
  'nutrition', 'beverage', 'beverages', 'drink', 'drinks', 'energy', 'sparkling', 'water', 'coffee', 'tea', 'juice', 'soda',
  'food', 'foods', 'snack', 'snacks', 'protein', 'beauty', 'cosmetics', 'skincare', 'skin', 'care', 'hair', 'makeup',
  'fragrance', 'labs', 'lab', 'goods', 'leather', 'apparel', 'health', 'wellness', 'fitness', 'home', 'pet', 'group', 'holdings']);
export const brandWords = (name) => String(name || '')
  .split(/[\s\-&/]+/).map((w) => w.replace(/[^\p{L}\p{N}'.]/gu, '').replace(/\.$/, ''))
  .filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w.toLowerCase()));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function namesBrand(text, brandName) {
  const full = String(brandName || '').trim();
  const hits = brandWords(full).filter((w) => new RegExp(`\\b${escapeRe(w)}\\b`, 'i').test(text || ''));
  if (full && new RegExp(`\\b${escapeRe(full)}\\b`, 'i').test(text || '') && !hits.length) hits.push(full);
  return hits;
}

/* Comments are one short, casual sentence: no follow-on sentences, no questions. */
export const COMMENT_MAX_CHARS = 160;
/* Hiring posts get up to two short sentences ("Hey, I personally don't need a job, but
   it seems like your social media operations are getting heavy. Just DM'd."). */
export function commentStyleProblems(text = '', { hiring = false } = {}) {
  const t = String(text).trim();
  const out = [];
  // Sentence ends: . ! ? followed by a space and more text.
  // Dotted abbreviations like "e.l.f." or "U.S." are not sentence ends.
  const plain = t.replace(/\b(?:[a-z]\.){2,}/gi, (m) => m.replace(/\./g, ''));
  const sentences = plain.split(/(?<=[.!?])\s+(?=\S)/).filter((x) => x.trim().length > 1);
  const maxSentences = hiring ? 2 : 1;
  if (sentences.length > maxSentences) out.push(`${sentences.length} sentences; keep it to ${hiring ? 'two short sentences' : 'one short sentence'}`);
  if (t.length > COMMENT_MAX_CHARS) out.push(`${t.length} characters; keep it short (under ${COMMENT_MAX_CHARS})`);
  if (t.includes('?')) out.push('asks a question; comments are just a reaction, no questions');
  return out;
}

/* Returns { draft (em dashes fixed), problems: [{ where, issue }] }. outreach: the person
   ids (person:N) that must each get exactly one connection note. */
export function validateDraft(draft, { evidence, playbook, brandName, picks = [], outreach = [], templates = {} }) {
  const problems = [];
  const fix = (s) => String(s || '').replace(/\s*—\s*/g, ', ').replace(/\s+–\s+/g, ' - ');
  const banned = (playbook.banned || []).map((b) => b.toLowerCase());
  const customers = (playbook.proof || []).filter((p) => p.kind !== 'company').map((p) => p.customer);

  // extraSources: text whose numbers are allowed without citation (the template's own
  // fixed wording, e.g. "15 minutes" in Ben's CTA).
  const check = (where, item, { maxChars = null, requireEvidence = true, extraSources = [] } = {}) => {
    if (!item) { problems.push({ where, issue: 'missing' }); return; }
    if (/[—]/.test(item.text)) item.text = fix(item.text);
    const ids = item.evidence || [];
    const unknown = ids.filter((id) => !evidence[id]);
    if (unknown.length) problems.push({ where, issue: `cites unknown evidence: ${unknown.join(', ')}` });
    if (requireEvidence && ids.filter((id) => evidence[id]).length === 0) problems.push({ where, issue: 'no evidence cited' });
    const sources = [...ids.filter((id) => evidence[id]).map((id) => evidence[id].numbers_text || evidence[id].text), ...extraSources];
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
    for (const issue of commentStyleProblems(c?.text, { hiring: isHiringPost(evidence[c?.post_id]?.post?.text) })) problems.push({ where: `comment ${i + 1}`, issue });
    if (!picks.includes(c.post_id)) problems.push({ where: `comment ${i + 1}`, issue: `is for ${c.post_id}, which is not one of the picked posts` });
  });
  if ((draft.comments || []).length !== picks.length) problems.push({ where: 'comments', issue: `expected ${picks.length} comments, got ${(draft.comments || []).length}` });
  check('own post', draft.own_post);
  if (draft.own_post) {
    const named = namesBrand(draft.own_post.text, brandName);
    if (named.length) problems.push({ where: 'own post', issue: `names the target brand (${named.join(', ')})` });
  }
  const limit = playbook.rules?.connection_note_max || 200;
  for (const pid of outreach) {
    const msgs = (draft.messages || []).filter((c) => c.person_id === pid);
    const who = evidence[pid]?.label || pid;
    if (msgs.length === 0) { problems.push({ where: `messages to ${who}`, issue: 'missing' }); continue; }
    if (msgs.length > 1) problems.push({ where: `messages to ${who}`, issue: `${msgs.length} sets, expected one` });
    const m = msgs[0];
    const t = templates[pid];
    const fixed = (tpl) => (tpl ? [String(tpl).replace(/\{[^}]*\}/g, ' ')] : []);
    check(`connection request to ${who}`, m.connection, { maxChars: limit, extraSources: fixed(t?.connection) });
    check(`first DM to ${who}`, m.first_dm, { extraSources: fixed(t?.first_dm) });
    if (t && m.connection && !templateAdherence(t.connection, m.connection.text)) problems.push({ where: `connection request to ${who}`, issue: 'does not keep the template wording; only fill the {slots}' });
    if (t && m.first_dm && !templateAdherence(t.first_dm, m.first_dm.text)) problems.push({ where: `first DM to ${who}`, issue: 'does not keep the template wording; only fill the {slots}' });
  }
  for (const m of draft.messages || []) {
    if (!outreach.includes(m.person_id)) problems.push({ where: 'messages', issue: `messages for ${m.person_id}, who is not on the outreach list` });
  }
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
  messages: z.array(z.object({ person_id: z.string(), connection: Item, first_dm: Item })),
  outlines: z.array(z.object({ track: z.enum(['pdf', 'loom']), bullets: z.array(Item) })),
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
- The connection request must be at most ${pb.rules.connection_note_max} characters.${exBlock('GOOD COMMENTS', ex.comments)}${exBlock('GOOD POSTS', ex.posts)}`;
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

/* ------------------------------ seniority + tracks ----------------------------- */

/* 1 = C-suite and VPs, 2 = directors and heads, 3 = everyone else (managers, leads,
   specialists, coordinators). */
export function seniorityTier(title = '') {
  const t = String(title).toLowerCase();
  if (/\b(assistant vice president|avp)\b/.test(t)) return 2;
  if (/\b(chief|cmo|cdo|cco|cxo|ceo|coo|president|founder|co-founder|vp|svp|evp|vice president)\b/.test(t)) return 1;
  if (/\b(director|head of|head,|head\b)/.test(t)) return 2;
  return 3;
}
const TIER_NAME = { 1: 'C-suite or VP', 2: 'director or head', 3: 'manager' };

/* The highest tier found among ALL stakeholders gets the PDF track; everyone below it
   gets the Loom track (Ben's rule). */
export function assignTracks(stakeholders = [], outreach = []) {
  const top = Math.min(...stakeholders.map((s) => seniorityTier(s.title)), 3);
  return outreach.map((o) => {
    const tier = seniorityTier(o.person.title);
    const track = tier === top ? 'pdf' : 'loom';
    const reason = track === 'pdf'
      ? (top === 1 ? `Top tier (${TIER_NAME[1]}), so the PDF` : `Most senior person found (no C-suite or VP found), so the PDF`)
      : `Below the top tier (a ${TIER_NAME[top]} was found), so the Loom`;
    return { ...o, tier, track, track_reason: reason };
  });
}

/* Pick one connection-note template and one DM template from the person's OWN track, so
   a Loom offer is never followed by a PDF DM. Rotates so two people on the same track
   don't get identical text. Templates needing a post are skipped when there are none. */
export function chooseTemplates(withTracks, tracks, { hasPosts = true } = {}) {
  const used = { pdf: 0, loom: 0 };
  const usable = (arr) => {
    const ok = arr.filter((t) => hasPosts || !/\{recent launch/i.test(t));
    return ok.length ? ok : arr;
  };
  return withTracks.map((o) => {
    const tr = tracks[o.track];
    const notes = usable(tr.connection_notes);
    const dms = usable(tr.first_dms);
    const k = used[o.track]++;
    return { ...o, asset: tr.asset, templates: { connection: notes[k % notes.length], first_dm: dms[k % dms.length] } };
  });
}

const normalize = (s) => String(s || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ').trim();

/* True if every fixed piece of the template (the text between {slots}) appears in the
   copy, in order. The model may only fill the slots. */
export function templateAdherence(template, text) {
  const pieces = String(template || '').split(/\{[^}]*\}/).map(normalize).filter(Boolean);
  const body = normalize(text);
  let at = 0;
  for (const piece of pieces) {
    const i = body.indexOf(piece, at);
    if (i === -1) return false;
    at = i + piece.length;
  }
  return true;
}

/* Values the server can fill without the model: name, company, follower total, platforms,
   industry and same-space customers (with the proof ids to cite). */
const listOf = (arr) => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} and ${arr.at(-1)}`);

/* Fit a connection note under the character limit by naming fewer same-space customers
   (3, then 2, then 1). The template wording never changes; only the list gets shorter.
   Slots the model fills itself (e.g. a recent launch) are estimated at 30 characters. */
export function fitSlotsToLimit(template, values, limit = 200) {
  const fill = (v) => String(template || '').replace(/\{([^}]+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : k.startsWith('recent') ? 'x'.repeat(30) : m));
  let names = [...(values.customer_names || [])];
  let ids = [...(values.customer_proof_ids || [])];
  let out = values;
  while (names.length > 1 && fill(out).length > limit) {
    names = names.slice(0, -1);
    ids = ids.slice(0, -1);
    out = { ...out, customers_in_their_space: listOf(names), customer_names: names, customer_proof_ids: ids };
  }
  return out;
}

export function slotValues(bundle, person, playbook) {
  const PN = { instagram: 'Instagram', tiktok: 'TikTok', x: 'X' };
  const counted = (bundle.social || []).filter((s) => PN[s.platform] && s.followers);
  const total = counted.reduce((t, s) => t + Number(s.followers), 0);
  const round = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
  const list = listOf;
  const industry = detectIndustry(bundle);
  const ranked = rankCaseStudies(playbook.proof || [], industry?.key);
  const pool = ranked.filter((c) => c.match).length ? ranked.filter((c) => c.match)
    : ranked.filter((c) => c.adjacent).length ? ranked.filter((c) => c.adjacent) : ranked.filter((c) => c.results.length);
  // Up to 3 same-space or adjacent customers; only 2 when falling back to other industries.
  const customers = pool.slice(0, ranked.some((c) => c.match || c.adjacent) ? 3 : 2);
  return {
    first_name: String(person.full_name || '').split(/\s+/)[0],
    company: String(bundle.brand.name || '').replace(/\b(llc|inc|co|corp|ltd)\.?$/i, '').trim(),
    total_followers: total ? round(total) : null,
    platforms: list(counted.map((s) => PN[s.platform])),
    industry: industry?.key || null,
    customers_in_their_space: list(customers.map((c) => c.customer)),
    customer_names: customers.map((c) => c.customer),
    customer_proof_ids: customers.map((c) => `proof:${c.items[0].id}`), // one source per named customer
  };
}

/* The week, in order: comments first, then connect with the bridges, then the wedge
   persona, then each first DM once that person accepts. */
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
    steps.push(g.key === '__brand'
      ? (g.n === 1 ? `Comment on ${brandName}'s LinkedIn page post` : `Comment on ${g.n} of ${brandName}'s LinkedIn page posts`)
      : `Comment on ${g.key}'s ${what}`);
  }
  const asset = (o) => (o.track === 'pdf' ? 'the PDF' : o.track === 'loom' ? 'the Loom' : null);
  const ordered = [...outreach.filter((x) => x.role === 'bridge'), ...outreach.filter((x) => x.role === 'wedge')];
  for (const o of ordered) steps.push(`Connect with ${o.person.full_name}${asset(o) ? ` (offers ${asset(o)})` : ''}${o.role === 'bridge' ? ', after commenting on their post' : ''}`);
  for (const o of ordered) steps.push(`When ${o.person.full_name} accepts, send ${asset(o) || 'the first DM'}${asset(o) ? ' + the 15-minute CTA' : ''}`);
  return steps;
}

/* --------------------------------- prompts --------------------------------- */

const PICK_SYSTEM = `You help a B2B rep at Nectar Social warm up a target account on LinkedIn. You choose which posts are worth engaging with this week. You only recommend; nothing is posted automatically.

Choose the requested number of posts from the candidate list. Prefer, in order: posts by the wedge persona, then their team, then the brand page. Prefer recent posts and posts with something specific to react to (a launch, a lesson, a result, a team moment) over generic promos. Older posts are marked with their age; use them only if they are clearly better. Use only post ids from the list. Give a one-sentence reason for each that names what in the post makes it worth a comment.`;

const DRAFT_SYSTEM = (pb) => `You write LinkedIn warm-up copy for a rep at Nectar Social, in the first person as the sender below. You only recommend: a human copies and sends everything by hand. Write the way people actually talk on LinkedIn: plain words, contractions, no sign-offs or signatures, no product names or jargon.

${playbookBlock(pb)}

WHAT TO WRITE:
1. comments: one per picked post (same post_id), and none if there are no picked posts. These are purely engagement, to introduce the sender's face to the brand: short, sweet and casual, like a real person scrolling LinkedIn. EXACTLY ONE sentence, short to medium (aim for under 20 words). React to the one thing a real person would notice; a light joke or a quirky line is welcome when it fits. Never recap or re-explain the post, never ask a question, never fish for results or metrics, no pitch, no Nectar mention, no links. Match the example comments.
   HIRING POSTS (listed under HIRING POSTS in the brief) are job announcements. Never earnestly restate or praise the job pitch (bad: "Love that the pitch is just connecting with people online and all things social."). Two good moves, up to two short sentences:
   a) read it as a sign their social workload is growing and say so casually: "Hey, I personally don't need a job, but it seems like your social media operations are getting heavy. Just DM'd."
   b) a light joke about one line in the post: "Chronically online as a job requirement is the most honest line I've seen in a job post."
   Keep the same spirit in your own words.
2. own_post: a LinkedIn post for the sender's own page this week. It must NOT name or tag the target brand or its people. Its job is credibility: when people at the account look at the sender's profile, they see that Nectar works with brands like theirs and gets results. If the playbook has an example post marked TEMPLATE, keep its wording and fill its slots. Use ONLY results from proof items. Nectar's company-wide results (proof items for "Nectar (all customers)") are always fine to use, credited to Nectar. Any customer-specific number must be credited to the customer it belongs to; you may name customers in the target's category even when they have no numbers. Set closest_category_used to the proof category you leaned on ("company" if you used only company-wide results).
3. messages: exactly one set per person on the OUTREACH list (person_id = their person id), each with a connection note and a first DM. Each person has a CONNECTION TEMPLATE and a DM TEMPLATE from their track (PDF or Loom). KEEP THE TEMPLATE WORDING EXACTLY and only replace the {slots}; never mix a Loom template with a PDF one, never add sentences.
   - Use the SLOT VALUES given for each person where they exist. Fill any other slot from the evidence: {recent launch or campaign from their posts} = a few plain words naming something from their or their team's posts; {proof_customer} and {proof_result} = one proof item, credited to its customer.
   - Placeholders in square brackets (e.g. [PDF, placeholder for this exercise]) stay exactly as written.
   - The connection note must stay within the character limit. The first DM delivers the asset and ends with the CTA in the template; it never makes a new offer.
   - Cite the evidence behind every slot value (stat:platforms for the follower total, proof: ids for customers and results, post: ids for launches).
4. outlines: for each track used (pdf and/or loom), 3 short bullets on what that asset would cover for this account, each citing proof or stats. Plain words.

EVIDENCE: every item lists the evidence ids it relies on (post:, fact:, stat:, person:, proof:). Any number you write must appear in an item you cite (rounding like 1,549,730 to 1.5M is fine). Do not state anything about the brand, the people or Nectar that is not in the cited evidence. If something would make the copy better but is not in the evidence, leave it out and mention it in notes_for_ben.`;

/* --------------------------------- drafting -------------------------------- */

/* bundle: getBrandBundle output. pickUrls: Ben's chosen post URLs (0..3; the AI fills the
   rest). Always returns a plan: with fewer posts it comments on fewer, with none it still
   drafts the own post, connection notes and the DM. */
/* While one long model call runs, ease the progress bar toward `to` so it never looks
   frozen; the real value jumps ahead as soon as the call returns. */
function creep(log, from, to, everyMs = 1500) {
  if (!log.progress) return () => {};
  let p = from;
  log.progress(p);
  const t = setInterval(() => { p += (to - p) * 0.07; log.progress(p); }, everyMs);
  return () => clearInterval(t);
}

export async function draftEngagement({ bundle, playbook, claude, pickUrls = [], log = () => {}, now = new Date() }) {
  const progress = (v) => log.progress?.(v);
  const all = collectPosts(bundle);
  const people = (bundle.stakeholders || []).filter((s) => (s.stakeholder_posts || []).length).length;
  log(`Reading ${all.length} LinkedIn post${all.length === 1 ? '' : 's'} from ${people} ${people === 1 ? 'person' : 'people'}${(bundle.brandPosts || []).length ? ` and the ${bundle.brand.name} page` : ''}`);
  const pool = buildPool(all, now);
  const forced = pickUrls.map((u) => all.find((p) => p.url === u)).filter(Boolean)
    .map((p) => ({ ...p, age_days: Math.round((now - new Date(p.posted_at)) / 864e5), older: (now - new Date(p.posted_at)) / 864e5 >= 90 }));
  const candidates = [...forced, ...pool.filter((p) => !forced.some((f) => f.url === p.url))].slice(0, Math.max(MAX_CANDIDATES, forced.length));
  if (!(bundle.stakeholders || []).length) throw new Error('No stakeholders found to address the outreach to. Run the research again.');

  const evidence = buildEvidence({ bundle, candidates, playbook });
  const idOf = (url) => Object.entries(evidence).find(([, v]) => v.kind === 'post' && v.url === url)?.[0];
  const want = Math.min(3, candidates.length);
  log(`${candidates.length} candidate posts (${candidates.filter((p) => p.older).length} older than 3 months); picking ${want}${forced.length ? `, ${Math.min(forced.length, 3)} chosen by you` : ''}`);
  progress(0.1);

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
    log(`Asking Claude to pick the best ${need} of ${rest.length} posts to comment on`);
    const stop = creep(log, 0.12, 0.26);
    try {
      const { parsed } = await claude.structured({ system: PICK_SYSTEM, user, schema: PickSchema, effort: 'low', maxTokens: 4000 });
      chosen = parsed.picks.filter((p, i, arr) => restEv[p.post_id] && arr.findIndex((x) => x.post_id === p.post_id) === i).slice(0, need);
    } catch (err) { log(`Pick step failed (${err.message}); using the ranked order`); } finally { stop(); }
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
  progress(0.28);

  // Who to reach: wedge persona (connect + DM) and bridges (connect).
  const outreach = chooseTemplates(assignTracks(bundle.stakeholders, planOutreach(bundle.stakeholders, pickedPosts)), playbook.tracks, { hasPosts: pickedPosts.length > 0 });
  const personId = (s) => Object.entries(evidence).find(([, v]) => v.kind === 'person' && v.stakeholder_id === s.id)?.[0];
  const outreachIds = outreach.map((o) => personId(o.person));
  const sequence = buildSequence({ brandName: bundle.brand.name, pickedPosts, outreach });
  log(`Outreach: ${outreach.map((o) => `${o.person.full_name} (${o.role}, ${o.track.toUpperCase()})`).join(', ')}`);
  for (const o of outreach) log(`${o.person.full_name}: ${o.track === 'pdf' ? 'PDF' : 'Loom'} track (${o.track_reason || o.role})`);
  progress(0.32);
  const templatesById = Object.fromEntries(outreach.map((o, i) => [outreachIds[i], o.templates]));

  // Step 2: drafts, validated, with one retry that feeds the problems back.
  const outreachLines = outreach.map((o, i) => {
    const post = pickedPosts.find((p) => p.stakeholder_id === o.person.id);
    const v = fitSlotsToLimit(o.templates.connection, slotValues(bundle, o.person, playbook), playbook.rules?.connection_note_max || 200);
    return `[${outreachIds[i]}] ${o.role.toUpperCase()}: ${o.person.full_name}, ${o.person.title}${o.fallback ? ' (no wedge persona found; most senior team member)' : ''}${post ? ` (you are commenting on their post ${idOf(post.url)})` : ''}
  TRACK: ${o.track.toUpperCase()} (${o.asset})
  CONNECTION TEMPLATE: ${o.templates.connection}
  DM TEMPLATE: ${o.templates.first_dm}
  SLOT VALUES: first_name=${v.first_name}; company=${v.company}; total_followers=${v.total_followers ?? '(no follower stats found)'} (cite stat:platforms); platforms=${v.platforms || '(none)'}; industry=${v.industry || 'consumer'}; customers_in_their_space=${v.customers_in_their_space || '(none)'} (cite ${v.customer_proof_ids.join(', ') || 'the proof items you name'})`;
  }).join('\n\n');
  const brief = `TARGET BRAND: ${bundle.brand.name}${bundle.brand.domain ? ` (${bundle.brand.domain})` : ''}

OUTREACH (one connection note and one first DM per person, from their own track's templates):
${outreachLines}

PICKED POSTS (one comment each):
${pickIds.length ? evidenceLines(Object.fromEntries(pickIds.map((id) => [id, evidence[id]])), ['post']) : '(none: there are no posts with text from the past year, so write no comments)'}

HIRING POSTS (among the picks): ${pickIds.filter((id) => isHiringPost(evidence[id]?.post?.text)).join(', ') || '(none)'}

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
  const checks = { evidence, playbook, brandName: bundle.brand.name, picks: pickIds, outreach: outreachIds, templates: templatesById };
  log(`Writing ${pickIds.length} comment${pickIds.length === 1 ? '' : 's'}, your post, and a connection request + first DM for ${outreach.length} ${outreach.length === 1 ? 'person' : 'people'}`);
  let stop = creep(log, 0.34, 0.8);
  let draft;
  try { ({ parsed: draft } = await claude.structured({ system, user: brief, schema: DraftSchema, effort: 'medium', maxTokens: 12000 })); } finally { stop(); }
  progress(0.82);
  log('Checking every number, source, character limit and banned phrase');
  let { problems } = validateDraft(draft, checks);
  if (problems.length) {
    log(`First draft had ${problems.length} problem(s), redrafting once`);
    for (const p of problems.slice(0, 4)) log(`Flagged: ${p.where}: ${p.issue}`);
    const retry = `${brief}\n\nYOUR PREVIOUS DRAFT:\n${JSON.stringify(draft)}\n\nIT FAILED THESE CHECKS. Fix every one and keep everything else:\n${problems.map((p) => `- ${p.where}: ${p.issue}`).join('\n')}`;
    stop = creep(log, 0.84, 0.97);
    try { ({ parsed: draft } = await claude.structured({ system, user: retry, schema: DraftSchema, effort: 'medium', maxTokens: 12000 })); } finally { stop(); }
    ({ problems } = validateDraft(draft, checks));
  }
  progress(0.98);
  log(problems.length ? `Done with ${problems.length} flagged problem(s), shown under "Check before using"` : 'Done, all checks passed');

  // Needs proof when none of the cited results is from the category the post leans on.
  // Needs proof only when the post leans on customer numbers from another category
  // (e.g. a beverage post carried by beauty numbers). Company-wide Nectar results, or a
  // matching-category result, are fine.
  const cited = (playbook.proof || []).filter((p) => draft.own_post.evidence.includes(`proof:${p.id}`));
  const needsProof = !cited.some((p) => p.kind === 'company'
    || (p.kind === 'result' && sameCategory(p.category, draft.own_post.closest_category_used)));
  const usedIds = new Set([
    ...draft.comments.flatMap((c) => c.evidence), ...pickIds, ...draft.own_post.evidence,
    ...draft.messages.flatMap((m) => [...m.connection.evidence, ...m.first_dm.evidence]),
    ...draft.outlines.flatMap((o) => o.bullets.flatMap((b) => b.evidence)),
  ]);
  const evidenceIndex = Object.fromEntries([...usedIds].filter((id) => evidence[id]).map((id) => {
    const { kind, url, label, text } = evidence[id];
    return [id, { kind, url, label, text: String(text).slice(0, 500) }];
  }));
  const limit = playbook.rules.connection_note_max;
  const empty = { text: '', evidence: [] };
  const msgFor = (pid) => draft.messages.find((m) => m.person_id === pid) || { connection: empty, first_dm: empty };

  return {
    picks: picks.map((p) => ({ url: evidence[p.post_id].url, reason: p.reason, by: p.by })),
    problems,
    output: {
      version: 3,
      sequence,
      outreach: outreach.map((o, i) => {
        const post = pickedPosts.find((p) => p.stakeholder_id === o.person.id);
        const m = msgFor(outreachIds[i]);
        const note = m.connection;
        return {
          name: o.person.full_name, title: o.person.title, persona: o.person.persona, linkedin_url: o.person.linkedin_url,
          role: o.role, fallback: o.fallback, track: o.track, asset: o.asset, tier: o.tier, track_reason: o.track_reason,
          why: o.role === 'bridge' ? 'You are commenting on their post, so the connection request has context.'
            : post ? 'Wedge persona, and you are commenting on their post.' : 'Wedge persona: the deal runs through them, even though they have not posted recently.',
          connection: { text: note.text, evidence: note.evidence, chars: note.text.length, limit },
          dm: m.first_dm,
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
      outlines: draft.outlines.filter((o) => outreach.some((x) => x.track === o.track)),
      notes_for_ben: draft.notes_for_ben,
      problems,
      evidence: evidenceIndex,
      playbook_status: playbook.status,
      brand_posts_pulled: (bundle.brandPosts || []).length > 0,
    },
  };
}

const sameCategory = (a, b) => String(a || '').toLowerCase().split(/[^a-z]+/).some((w) => w.length > 3 && String(b || '').toLowerCase().includes(w));
