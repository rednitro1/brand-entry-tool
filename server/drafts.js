import { makeClaude } from './providers/claude.js';
import { draftEngagement } from './modules/engagement.js';
import { SEED_PLAYBOOK, parsePlaybook } from './playbook.js';

/* Engagement drafts run in the background like research runs: the POST returns a draft
   id, the account page polls the brand bundle (which carries the latest draft), so
   switching tabs or refreshing never loses one. */

export const ENGAGEMENT_MODEL = () => process.env.ENGAGEMENT_MODEL || 'claude-sonnet-5-5';

export async function currentPlaybook(db) {
  const row = await db.getPlaybook();
  return row ? { id: row.id, content: parsePlaybook(row.content), saved: true, created_at: row.created_at } : { id: null, content: parsePlaybook(SEED_PLAYBOOK), saved: false };
}

export async function executeDraft({ db, draftId, slug, pickUrls = [], claude = makeClaude(process.env.ANTHROPIC_API_KEY, { model: ENGAGEMENT_MODEL() }) }) {
  try {
    const bundle = await db.getBrandBundle(slug);
    if (!bundle) throw new Error('Brand not found.');
    const { content: playbook } = await currentPlaybook(db);
    const r = await draftEngagement({ bundle, playbook, claude, pickUrls });
    const u = claude.usage();
    await db.finishDraft(draftId, {
      status: 'done', output: r.output, picks: r.picks, rejected: r.problems,
      costUsd: u.costUsd || 0, inputTokens: u.input ?? null, outputTokens: u.output ?? null,
    });
  } catch (err) {
    const u = claude.usage?.() || {};
    await db.finishDraft(draftId, { status: 'failed', error: String(err.message).slice(0, 500), costUsd: u.costUsd || 0 }).catch(() => {});
  }
}
