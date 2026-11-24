import { makeClaude } from './providers/claude.js';
import { draftEngagement } from './modules/engagement.js';
import { SEED_PLAYBOOK, parsePlaybook } from './playbook.js';
import { makeLiveLog } from './runner.js';

/* Engagement drafts run in the background like research runs: the POST returns a draft
   id, the account page polls the brand bundle (which carries the latest draft), so
   switching tabs or refreshing never loses one. */

export const ENGAGEMENT_MODEL = () => process.env.ENGAGEMENT_MODEL || 'claude-sonnet-5-5';

export async function currentPlaybook(db) {
  const row = await db.getPlaybook();
  return row ? { id: row.id, content: parsePlaybook(row.content), saved: true, created_at: row.created_at } : { id: null, content: parsePlaybook(SEED_PLAYBOOK), saved: false };
}

export async function executeDraft({ db, draftId, slug, pickUrls = [], claude = makeClaude(process.env.ANTHROPIC_API_KEY, { model: ENGAGEMENT_MODEL() }) }) {
  // Same live log as research runs: lines + progress land on the draft row once a second.
  const live = makeLiveLog({ write: (patch) => db.updateDraft(draftId, patch) });
  const log = live.say;
  try {
    log('Loading the research and your Playbook');
    const bundle = await db.getBrandBundle(slug);
    if (!bundle) throw new Error('Brand not found.');
    const { content: playbook, saved } = await currentPlaybook(db);
    const proofs = (playbook.proof || []).length;
    log(`Playbook: ${saved ? 'your saved version' : 'the seed version'}, ${proofs} proof item${proofs === 1 ? '' : 's'}, PDF and Loom templates`);
    log.progress(0.04);
    const r = await draftEngagement({ bundle, playbook, claude, pickUrls, log });
    const u = claude.usage();
    log(`Cost: $${Number(u.costUsd || 0).toFixed(3)} on ${ENGAGEMENT_MODEL()}`);
    await db.finishDraft(draftId, {
      status: 'done', output: r.output, picks: r.picks, rejected: r.problems,
      costUsd: u.costUsd || 0, inputTokens: u.input ?? null, outputTokens: u.output ?? null, log: await live.close(),
    });
  } catch (err) {
    const u = claude.usage?.() || {};
    log(`Stopped: ${err.message}`);
    await db.finishDraft(draftId, { status: 'failed', error: String(err.message).slice(0, 500), costUsd: u.costUsd || 0, log: await live.close() }).catch(() => {});
  }
}
