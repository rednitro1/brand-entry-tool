import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { round4 } from './firecrawl.js';

/* Structured-output calls to Claude. Server-side refusal fallback is on ("default"
   routing), so a policy decline on one model is retried inside the same call rather than
   surfacing as an empty module. Per-model prices ($/MTok) are used to report cost. */

const PRICES = {
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
  'claude-opus-5': { in: 5, out: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { in: 5, out: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.1 },
};

export function makeClaude(apiKey, { model = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5', client } = {}) {
  const anthropic = client || new Anthropic({ apiKey });
  const totals = { input: 0, output: 0, costUsd: 0, calls: 0 };

  function addUsage(servedModel, usage = {}) {
    const p = PRICES[servedModel] || PRICES[model] || PRICES['claude-opus-5-5'];
    const input = usage.input_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const cacheWrite = usage.cache_creation_input_tokens || 0;
    const output = usage.output_tokens || 0;
    const cost = (input * p.in + cacheWrite * p.in * 1.25 + cacheRead * p.cacheRead + output * p.out) / 1e6;
    totals.input += input + cacheRead + cacheWrite;
    totals.output += output;
    totals.costUsd += cost;
    totals.calls += 1;
    return { input: input + cacheRead + cacheWrite, output, costUsd: round4(cost) };
  }

  return {
    model,
    /* Returns {parsed, usage, servedModel}. Throws on refusal or unparseable output so the
       module records a labeled gap instead of inventing data. */
    async structured({ system, user, schema, effort = 'medium', maxTokens = 16000 }) {
      const stream = anthropic.beta.messages.stream({
        model,
        max_tokens: maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort, format: zodOutputFormat(schema) },
      });
      const msg = await stream.finalMessage();
      const usage = addUsage(msg.model, msg.usage);
      if (msg.stop_reason === 'refusal') {
        throw new Error(`model declined (${msg.stop_details?.category || 'no category'})`);
      }
      if (msg.stop_reason === 'max_tokens') throw new Error('model output hit max_tokens before finishing');
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      let parsed;
      try { parsed = schema.parse(JSON.parse(text)); } catch (err) {
        throw new Error(`model output did not match the schema: ${err.message.slice(0, 200)}`);
      }
      return { parsed, usage, servedModel: msg.model };
    },
    usage() { return { provider: 'anthropic', model, ...totals, costUsd: round4(totals.costUsd) }; },
  };
}
