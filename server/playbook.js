import { z } from 'zod';

/* The Playbook: the copywriting context every engagement draft is grounded in. Ben edits
   it in the Playbook tab; each save is a new version. Drafts may only state results that
   are in `proof`, each with a public source. */

const CUSTOMERS_URL = 'https://www.nectarsocial.com/customers/';
const MENLO_URL = 'https://menlovc.com/perspective/nectar-social-rewriting-the-modern-marketing-playbook/';
const GV_URL = 'https://www.gv.com/news/nectar-social';

const ProofSchema = z.object({
  id: z.string().min(1).max(20),
  customer: z.string().max(80),
  category: z.string().max(40),
  claim: z.string().min(1).max(400),
  source_url: z.string().url().or(z.literal('')),
  kind: z.enum(['result', 'quote', 'customer', 'company']).default('result'),
});

export const PlaybookSchema = z.object({
  status: z.enum(['seed', 'reviewed']).default('seed'),
  sender: z.object({ name: z.string().max(80), role: z.string().max(120), headline: z.string().max(220) }),
  product: z.object({
    one_liner: "Nectar Social is one place where a brand's social, community, creator, customer service and insights teams see every comment, DM, post and creator conversation, and answer them fast in the brand's own voice.",
    value_props: [
      "Answers comments and DMs in the brand's own voice, fast, at a volume no team could keep up with.",
      'Finds and checks content creators who fit the brand, including their past brand deals.',
      'Shows how much in sales comes from social media conversations.',
      'Tracks what people say about the brand across Instagram, TikTok, Facebook, LinkedIn, Reddit and X.',
      'The brand team stays in charge of tone, rules and approvals.',
    ],
    who_its_for: z.string().max(400),
    pains: z.array(z.string().max(300)).max(12),
  }),
  proof: z.array(ProofSchema).max(60),
  voice: z.object({ tone: z.array(z.string().max(200)).max(15), use: z.array(z.string().max(200)).max(30) }),
  banned: z.array(z.string().min(2).max(80)).max(60),
  examples: z.object({
    comments: z.array(z.string().max(1500)).max(15),
    connection_notes: z.array(z.string().max(600)).max(15),
    dms: z.array(z.string().max(2500)).max(15),
    posts: z.array(z.string().max(4000)).max(10),
  }),
  rules: z.object({
    connection_note_max: z.number().int().min(100).max(300),
    dm_offer: z.string().max(200),
    extra: z.array(z.string().max(300)).max(20),
  }),
});

export const SEED_PLAYBOOK = {
  status: 'seed',
  sender: { name: 'Ben Sollitt', role: 'GTM at Nectar Social', headline: '' },
  product: {
    one_liner: 'Nectar Social is an agentic operating system for social: one platform where an AI agent (Ren) works alongside the community, creator, social, paid, customer care and insights teams, from the same fans, creators, posts and conversations.',
    value_props: [
      'Replies to comments and DMs in the brand\'s own voice, fast, at a volume no team could staff.',
      'Finds and vets creators against the brand guide (Creator Agent), including past brand deals and safety flags.',
      'Ties a social conversation back to revenue, so social shows up as a measurable channel.',
      'Social listening across Meta, TikTok, LinkedIn, Reddit and X through official data partnerships.',
      'Keeps the brand team in control of voice, guidelines and approvals; Nectar runs the operation.',
    ],
    who_its_for: 'Consumer brands with big, busy social audiences (beauty, food and beverage, retail, DTC) whose social, community, creator and customer care teams are stretched across many platforms.',
    pains: [
      'Too many comments and DMs to answer well, so response rates and reply times slip.',
      'Creator programs run on spreadsheets and gut feel.',
      'Social, creator, care and insights work in separate tools with no shared context.',
      'Hard to prove what social is worth in revenue.',
    ],
  },
  proof: [
    { id: 'p1', customer: 'Portland Leather Goods', category: 'accessories / DTC', kind: 'result', claim: 'Traced $10.2M in sales back to their social media in under a year', source_url: CUSTOMERS_URL },
    { id: 'p2', customer: 'Portland Leather Goods', category: 'accessories / DTC', kind: 'result', claim: 'Handles 70,000+ social media interactions a month and now replies to over 90% of them, up from 40%', source_url: CUSTOMERS_URL },
    { id: 'p3', customer: 'e.l.f. Beauty', category: 'beauty', kind: 'result', claim: 'The share of social comments and messages their team actually acts on went from 15% to 92%', source_url: CUSTOMERS_URL },
    { id: 'p4', customer: 'e.l.f. Beauty', category: 'beauty', kind: 'result', claim: 'The time it takes them to answer a DM went from 11 hours to 9 minutes', source_url: CUSTOMERS_URL },
    { id: 'p5', customer: 'e.l.f. Beauty', category: 'beauty', kind: 'result', claim: 'Runs their social media, community, creator, customer service and insights work in one place across four brands and three regions; their Chief Technology and AI Officer, Ekta Chopra, says their response rate went up 60%', source_url: CUSTOMERS_URL },
    { id: 'p6', customer: 'Jones Road Beauty', category: 'beauty', kind: 'result', claim: 'Engagement went up 150%, with replies written automatically in the brand\'s own voice (Cody Plofker, CEO)', source_url: CUSTOMERS_URL },
    { id: 'p7', customer: 'Solawave', category: 'beauty devices', kind: 'result', claim: 'Their AI quiz had 90% of people finish it and added 30K+ emails to their list (Andrew Silberstein, CEO)', source_url: CUSTOMERS_URL },
    { id: 'p8', customer: 'Glamnetic', category: 'beauty', kind: 'result', claim: 'About 80% of their DMs get answered automatically, with product recommendations tailored to each person', source_url: CUSTOMERS_URL },
    { id: 'p9', customer: 'Fishwife', category: 'food and beverage', kind: 'quote', claim: 'Uses Nectar to find new content creators to work with and to keep in touch with the creators they already work with (Halle Gold, Community and Influencer Lead)', source_url: CUSTOMERS_URL },
    { id: 'p10', customer: 'David Protein', category: 'food and beverage', kind: 'quote', claim: 'Uses Nectar to research which content creators to partner with; their Brand Marketing Manager says it is now a core part of how the team runs influencer programs', source_url: CUSTOMERS_URL },
    { id: 'p11', customer: 'Liquid Death', category: 'food and beverage', kind: 'customer', claim: 'Nectar customer', source_url: CUSTOMERS_URL },
    { id: 'p12', customer: 'OLIPOP', category: 'food and beverage', kind: 'customer', claim: 'Early Nectar customer', source_url: GV_URL },
    { id: 'p13', customer: 'Nectar (all customers)', category: 'company', kind: 'company', claim: 'Nectar answers 10M+ customer conversations a week for its brands, has traced $100M in sales to those conversations, and has engaged 50M people (Menlo Ventures, May 2026)', source_url: MENLO_URL },
  ],
  voice: {
    tone: [
      'Plain, specific and human. Write like a peer in social, not a vendor.',
      'Short sentences. Lead with what they actually did or said.',
      'Curious, not salesy. One idea per message.',
      "Use plain words a busy marketer would say out loud. No product names or jargon (e.g. 'creator discovery', 'Creator Agent', 'engagement actioned', 'agentic', 'attributed revenue').",
    ],
    use: ['comments and DMs', 'creators', 'community', 'response time', 'brand voice'],
  },
  banned: [
    'congrats on the raise', 'hope this finds you well', 'I hope you are well', 'synergy', 'game-changer', 'game changer',
    'circle back', 'touch base', 'leverage', 'revolutionize', 'cutting-edge', 'unlock', 'in today\'s fast-paced',
    'I came across your profile', 'quick question', 'pick your brain',
    'thanks for connecting', "hope you're doing well", "hope you're well", 'just wanted to', "I'd love to", 'reaching out because',
  ],
  examples: { comments: [], connection_notes: [], dms: [], posts: [] },
  rules: {
    connection_note_max: 200,
    dm_offer: 'a short Loom video showing how Nectar would help their team',
    extra: [
      'Never name or tag the target brand in my own post.',
      'Comments react to what the post says; no pitch, no links, no mention of Nectar.',
      'Only state results from the proof library, credited to the right customer.',
    ],
  },
};

export function parsePlaybook(content) {
  return PlaybookSchema.parse(content);
}
