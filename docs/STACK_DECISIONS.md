# Stack decisions

Running log, appended as the tool is built. The final write-up is distilled from this.

## Shape
- **React + Vite SPA served by one Express service on Railway.** Same shape as my Creator Analytics Platform: one deploy, one URL, and every provider key stays on the server.
- **Supabase Postgres, its own project.** Brand is the core object. RLS is on with no policies, so only the server's service-role key can touch data.
- **Run state is persisted (`runs`, `run_modules`), not kept in memory.** A restart can't lose a run in flight, the UI streams per-module status by polling, and cost/duration per run is queryable. This fixes a gap from the reference app, which kept jobs in memory.

## Enrichment (people)
Chosen: **Apollo people search → Prospeo fallback** to find wedge-persona people, then **Firecrawl `people_company_enrich`** for title/tenure and **Alexandria `harvestapi linkedin/profile-posts` / `scrapecreators linkedin/post`** for their public LinkedIn posts.

Alternatives considered (to be filled with real numbers as I test):
1. Clay
2. LinkedIn Sales Navigator
3. Custom LinkedIn scraper
4. Apify LinkedIn actors
5. Firecrawl/Alexandria only (find + enrich + posts from one vendor)
6. Prospeo as primary

## Public-URL safeguards
- The Alani Nu example is cached and makes no provider calls.
- Live runs need an access code, are limited to 3 per hour per visitor (salted IP hash, raw IPs are never stored), and fall under a $25/day global spend cap that reserves budget for in-flight runs. Max posts per platform per run is capped.
- No delete endpoints. The only write endpoint is `POST /api/runs`.

## Where the data was bad, and the workaround
(Seeded from the manual Alani Nu research; more get added as the tool hits them.)
- LinkedIn profile pages timed out in the browser extension → routed to Firecrawl provider data for profiles and posts.
- A scraped deal article named the co-founder inconsistently (Katy Schneider / Katy Hearn, plus a conflated co-founder name) → single-source scraped text is labeled `single_source` and cross-checked against a second source.
- A working note said Fink replaced Rishi Daing as CMO. Celsius's own releases said Daing was the Celsius-wide CMO moving to Rockstar, and Fink became Alani Nu CMO → primary sources win, conflicts are surfaced in `brand_profiles.conflicts` with both links.
- Titles drifted between notes and LinkedIn ("Director of Marketing" vs the real Director of Social Media, Influencer and Collegiate Marketing) → titles always come from the profile.
- A vendor post made unverifiable claims (creator spend, a 300+ campus ambassador program) → labeled `vendor_claim`.
- The Instagram post scraper returns no follower counts and media URLs that expire → a separate profile scrape supplies counts, and no thumbnails are shown (posts are linked instead).
- Leadership seat swaps inferred from press-release wording → labeled `inferred`.

### Found while building (live Alani Nu runs, 2026-11-22)
- **Handles don't match the brand name.** Alani Nu's Instagram, TikTok and X are all `alaninutrition`. Handles now come from the brand's own site footer (most frequent profile link per platform), never guessed from the name.
- **No LinkedIn link on the brand site.** It comes from a `site:linkedin.com/company` search instead and is labeled `single_source` (it resolved to `alani-nutrition`).
- **Firecrawl rate limit (11 req/min on this plan) dropped a key page.** Calls now run at most 3 at a time, and a 429 waits for the reset time Firecrawl names, then retries up to twice. One run went from a lost page to 1 retry and +1 source.
- **Generic queries miss recent news.** The first run found nothing newer than 2025. Dated queries (current-year leadership, quarterly results) were added.
- **A title change can show up on LinkedIn before any press.** Fink's "Chief Marketing Officer at Alani Nu" appears only in her LinkedIn headline, while every press release still says Chief Creative Officer. Titles come from the profile, and the conflict is shown.
- **Receipts check:** every claim must cite a page the tool fetched and quote it verbatim. Of 25 claims in the last run, 25 passed; the fixture tests cover hallucinated quotes, unfetched URLs and missing URLs.
- **Cost per profile:** about $0.40 (Firecrawl ~36 credits, Claude Opus 5.5 ~48k in / 9k out), 66 to 131 seconds.
