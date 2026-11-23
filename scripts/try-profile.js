/* Dev script: run resolve + profile live for one brand and save the result.
   Usage: node scripts/try-profile.js "Alani Nu" fixtures/alani-nu */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../server/env.js';
loadEnv();
const { makeFirecrawl } = await import('../server/providers/firecrawl.js');
const { makeClaude } = await import('../server/providers/claude.js');
const { resolveBrand } = await import('../server/modules/resolve.js');
const { buildProfile } = await import('../server/modules/profile.js');

const [input = 'Alani Nu', outDir = 'fixtures/alani-nu'] = process.argv.slice(2);
const log = (m) => console.log(`  ${m}`);
const fc = makeFirecrawl(process.env.FIRECRAWL_API_KEY, { onRetry: log });
const claude = makeClaude(process.env.ANTHROPIC_API_KEY);
const t0 = Date.now();
const brand = await resolveBrand({ input, fc, log });
const profile = await buildProfile({ brand, fc, claude, log });
const cost = { firecrawl: fc.usage(), claude: claude.usage(), seconds: Math.round((Date.now() - t0) / 1000) };
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'brand.json'), JSON.stringify(brand, null, 2));
fs.writeFileSync(path.join(outDir, 'profile.json'), JSON.stringify({ ...profile, cost }, null, 2));
console.log(JSON.stringify(cost));
