# Stack decisions

Running log, appended as the tool is built. The final write-up is distilled from this.

## Shape
- **React + Vite SPA served by one Express service on Railway.** Same shape as my Creator Analytics Platform: one deploy, one URL, and every provider key stays on the server.
- **Supabase Postgres, its own project.** Brand is the core object. RLS is on with no policies, so only the server's service-role key can touch data.
- **Run state is persisted (`runs`, `run_modules`), not kept in memory.** A restart can't lose a run in flight, the UI streams per-module status by polling, and cost/duration per run is queryable. This fixes a gap from the reference app, which kept jobs in memory.

## Enrichment (people)
Chosen: **Apollo first, Prospeo fallback** to find wedge-persona people (Ben's own keys, called directly). Apollo's match record also carries title and employment history, so tenure comes from Apollo and no separate enrichment provider is needed. Public LinkedIn posts come from **Firecrawl's Alexandria `harvestapi linkedin/profile-posts`**, read only.

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

### Stakeholders (live calls, 2026-11-22)
- **Apollo search is free but blind.** It returns obfuscated last names and no LinkedIn URL. The tool runs two free searches (brand domain, then brand name across all companies), classifies titles, and spends a match credit only on wedge personas, capped at 6 per run. This is the "qualify before paid enrichment" rule from my recruiting pipelines.
- **People get filed under the parent.** "Customer Support Manager - Alani Nu" sits under CELSIUS in Apollo, so the brand-name search exists to catch them.
- **Apollo employment history duplicates roles across brand and parent.** Kira's current title appears under both "Alani Nutrition" and "CELSIUS ... - Alani Nu". Tenure uses the earliest matching start: in role since 2025-10, at the company since 2021-03 (intern). That matches the manual research ("at the brand since 2021").
- **Timezone bug caught by a fixture:** `new Date('2025-10-01')` is Sept 30 in US time zones, so month math uses UTC. The tests also run under `TZ=UTC`, which matches Railway.
- **Neither Apollo nor Prospeo has the Alani Nu CMO.** JoBeth Fink's "Chief Marketing Officer at Alani Nu" appears only in her public LinkedIn headline. Apollo has no record of her, and Prospeo's domain + seniority search returned one unrelated creative director. The tool reports this as a gap ("No CMO found in Apollo or Prospeo") instead of filling it from memory.
- **Prospeo exact-title filters return NO_RESULTS** unless titles match its taxonomy, so the fallback filters on domain + seniority (C-Suite/VP/Director) and classifies titles locally. NO_RESULTS is free; Prospeo rate-limits quickly, so the client waits and retries.
- **LinkedIn posts: reposts are not flagged.** 5 of Kira's 9 feed items are John Fieldly's or Celsius's posts. They're detected by the author slug in the post URL, and only her own posts count toward her pattern. All three receipt posts from the manual research came back, at 1 Firecrawl credit per profile (the contract says 4).
- **Kira's pattern, computed:** 4 own posts (2 promotions, 2 team or speaking), 0 tactics, latest own post is the Mar 2026 PepsiCo HQ talk. This matches the manual read that she rarely posts tactics.

### Social (live calls, 2026-11-22)
- **Alani Nu's Instagram is age-restricted** ("You must be 18 years old or over to see this profile"), presumably because it's an energy drink. `apify/instagram-profile-scraper` still returns followers (1,549,728) and following (22) but no post count. `apify/instagram-post-scraper` returns zero posts, only a "Restricted profile" item. Any age-gated beverage or alcohol brand will hit the same wall with anonymous scrapers. Logged-in scraping is ruled out (no credentials in this tool).
- **Fallback tried: Firecrawl Alexandria `scrapecreators instagram/user-posts`** returned `provider_unavailable` (503) twice. It wasn't billed.
- **Page stats, one pull per platform (Alani Nu).** The handles come from the resolve step, out of the brand's own site footer:
  - Instagram (`apify/instagram-profile-scraper`): 1,549,728 followers, 22 following. No post count, because the account is age-restricted.
  - TikTok (`clockworks/tiktok-profile-scraper`, 1 result): 1.1M followers, 43 following, 459 videos, 11.1M likes.
  - X (`apidojo/twitter-user-scraper`, follower/following extraction off, since it otherwise scrapes the whole follower list): 32,677 followers, 10 following, 26,119 posts.
  - LinkedIn: a plain Firecrawl page fetch returns a firmographic card (still says "Type: Private") with no followers. Alexandria `orbisearch companies/enrich` returns 74,397 followers and 673 employees, billed 0 credits on this call.

## Live run log and progress bar
- **What:** each module streams plain-English log lines plus a 0..1 progress value to `run_modules` (at most one write a second). The page polls the run every 1.5s and shows a weighted progress bar and a console.
- **Why polling, not SSE/websockets:** the run already lives in Postgres and the page already polled. Polling survives refreshes, deploys and flaky networks with no extra infrastructure.
- **Switching tabs:** the active run id is held above the pages and in the browser, so tabs, refreshes and closing the tab don't lose it. The sidebar shows its status everywhere. The account only auto-opens if the run finishes while Search is on screen; otherwise the sidebar offers "Open account" and nothing yanks the viewer away.
- **Safety:** log lines say what the tool is doing, never keys, emails or raw responses; a scrubber masks anything token-shaped. Bad input (non-LinkedIn URLs) is refused before a run starts.
- **Testing without spend:** `FAKE_MODE=1` runs the server on an in-memory database with recorded responses and delays. It refuses to start on Railway or with NODE_ENV=production.

## Part 2: warm-up + first touch (engagement plan)
- **More LinkedIn activity:** posts for every stakeholder (cap 12) plus the brand's LinkedIn page (HarvestAPI `linkedin/company-posts` via Firecrawl, 4 credits a call). Bloom showed why: its wedge personas never post, and the recent activity is the brand page and team reposts of it.
- **Playbook, not prompt tweaks:** copywriting context (product, proof library, voice, banned phrases, Ben's own examples) lives in a versioned Playbook table that Ben edits in the tool. Seeded from nectarsocial.com/customers, Menlo and GV with a source on every proof item.
- **Model:** Sonnet 5.5 for picking and writing (Ben's call; about $0.05 to $0.12 a draft), set by `ENGAGEMENT_MODEL`. Research stays on Opus.
- **On demand:** drafting is a button on the account, not part of every run, so it only costs money when someone wants copy.
- **Receipts for copy:** every input gets an id; every draft cites ids. The server rejects unknown ids, numbers that are not in the cited items (rounding allowed), banned phrases, over-limit connection notes, naming the target brand in the own post, and naming a Nectar customer without citing that customer's proof. One automatic retry with the problems fed back, then anything left is shown as "check before using", never hidden.
- **Honest proof:** Nectar has no public food and beverage result with a number, so a post for a beverage brand says what Fishwife and David Protein use Nectar for and borrows numbers from named customers in other categories, credited, with a visible "needs proof" note.
- **Recommends only:** copy buttons; nothing posts, connects or messages.
