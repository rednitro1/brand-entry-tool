import React from 'react';

/* Two read-only pages: how the tool is built (Stack Decisions) and what was left out
   (Appendix: What I Cut). Static content, no API calls. Numbers come from live runs logged
   in docs/STACK_DECISIONS.md. */

const TOOLS = {
  firecrawl: { name: 'Firecrawl', logo: '/logos/firecrawl.png' },
  claude: { name: 'Claude', logo: '/logos/claude.png' },
  apollo: { name: 'Apollo', logo: '/logos/apollo.svg' },
  prospeo: { name: 'Prospeo', logo: '/logos/prospeo.png' },
  apify: { name: 'Apify', logo: '/logos/apify.svg' },
  orbisearch: { name: 'Orbisearch', logo: '/logos/orbisearch.svg' },
  harvestapi: { name: 'HarvestAPI', logo: '/logos/harvestapi.png' },
  supabase: { name: 'Supabase', logo: '/logos/supabase.png' },
  railway: { name: 'Railway', logo: '/logos/railway.png' },
  instagram: { name: 'Instagram', logo: '/logos/instagram.png' },
  tiktok: { name: 'TikTok', logo: '/logos/tiktok.png' },
  x: { name: 'X', logo: '/logos/x.png' },
  linkedin: { name: 'LinkedIn', logo: '/logos/linkedin.png' },
};

/* ---------------------------------- diagram --------------------------------- */

function Logo({ t, size = 28 }) {
  const tool = TOOLS[t];
  return tool ? <img className="logo" src={tool.logo} alt="" width={size} height={size} loading="lazy" /> : null;
}

/* kind: 'code' = our own server code (no outside call), 'you' = a person. */
function Node({ t, title, sub, cost, kind, logos }) {
  return (
    <div className={`node${kind ? ` n-${kind}` : ''}`}>
      {logos ? <span className="logo-stack">{logos.map((l) => <Logo key={l} t={l} size={20} />)}</span>
        : t ? <Logo t={t} />
        : <span className="node-badge" aria-hidden="true">{kind === 'you' ? <IconUser /> : <IconCode />}</span>}
      <div className="node-text">
        <strong>{title || TOOLS[t]?.name}</strong>
        {sub && <span>{sub}</span>}
        {cost && <em>{cost}</em>}
      </div>
    </div>
  );
}

function Arrow({ label, down }) {
  return (
    <div className={`arrow${down ? ' down' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 44 12" preserveAspectRatio="none"><path d="M1 6h38" /><path d="M34 1.5 40 6l-6 4.5" /></svg>
      {label && <span>{label}</span>}
    </div>
  );
}

const Or = ({ text = 'or' }) => <span className="join" aria-hidden="true">{text}</span>;

function Chain({ children }) {
  // Put an arrow between each step; a step can be an array (parallel options).
  const steps = React.Children.toArray(children);
  return (
    <div className="chain">
      {steps.map((s, i) => <React.Fragment key={i}>{i > 0 && <Arrow />}{s}</React.Fragment>)}
    </div>
  );
}

const STAGES = [
  {
    title: 'Find the brand',
    sub: 'Official site, then the social profiles linked in its footer.',
    chain: [
      <Node key="a" t="firecrawl" title="Firecrawl Search" sub="finds the official site" />,
      <Node key="b" t="firecrawl" title="Firecrawl Scrape" sub="reads the footer for IG, TikTok, X, LinkedIn" />,
    ],
  },
  {
    title: 'Brand profile',
    sub: 'Facts with receipts. Anything without a matching quote is dropped.',
    chain: [
      <Node key="a" t="firecrawl" title="Firecrawl Search + Scrape" sub="6 searches, reads the best pages" />,
      <Node key="b" t="claude" title="Claude Opus 5.5" sub="pulls facts, each with a quote" cost="about $0.40 a profile, with Firecrawl" />,
      <Node key="c" kind="code" title="Receipts check" sub="quote must be on the page" />,
    ],
  },
  {
    title: 'Stakeholders',
    sub: 'Wedge roles first, then the social team under them.',
    chain: [
      <Node key="a" t="apollo" title="Apollo search" sub="by domain, then by name" cost="free" />,
      <Node key="b" t="apollo" title="Apollo match" sub="name, LinkedIn, job history" cost="1 credit each, max 6" />,
      <Node key="c" t="prospeo" title="Prospeo" sub="only for roles Apollo missed" cost="free when it finds nothing" />,
    ],
  },
  {
    title: 'Social stats',
    sub: 'Followers, following and post counts per platform.',
    chain: [
      <div key="a" className="group">
        <Node logos={['instagram', 'tiktok', 'x']} title="Apify actors" sub="Instagram, TikTok and X profiles" cost="billed per run" />
        <Or text="+" />
        <Node t="orbisearch" title="Orbisearch via Firecrawl" sub="LinkedIn followers, employees" />
      </div>,
    ],
  },
  {
    title: 'LinkedIn posts',
    sub: 'Read-only. No LinkedIn login is ever used.',
    chain: [
      <div key="a" className="group">
        <Node t="harvestapi" title="HarvestAPI via Firecrawl" sub="each stakeholder's posts (up to 12 people)" cost="4 credits a call" />
        <Or text="+" />
        <Node t="harvestapi" title="HarvestAPI via Firecrawl" sub="the brand's LinkedIn page posts" cost="4 credits a call" />
      </div>,
    ],
  },
];

function FlowDiagram() {
  return (
    <div className="flow" role="img" aria-label="How information flows through the Brand Entry Tool">
      <div className="frame">
        <div className="frame-label"><Logo t="railway" size={18} /> Runs on Railway: one service for the app, the API and the background jobs</div>

        <div className="flow-top">
          <Node kind="you" title="You" sub="brand name or LinkedIn company URL" />
          <Arrow label="access code, $25/day cap" />
          <div className="phase-tag">Research run<span>background job with a live log</span></div>
        </div>

        <div className="research">
          {STAGES.map((s, i) => (
            <React.Fragment key={s.title}>
              <div className="stage" style={{ gridRow: i + 1 }}>
                <div className="stage-head"><span className="stage-num">{i + 1}</span><div><h3>{s.title}</h3><p>{s.sub}</p></div></div>
                <Chain>{s.chain}</Chain>
              </div>
              <div className="to-rail" style={{ gridRow: i + 1 }}><Arrow /></div>
            </React.Fragment>
          ))}
          <div className="rail" style={{ gridRow: `1 / span ${STAGES.length}` }}>
            <Logo t="supabase" size={36} />
            <strong>Supabase</strong>
            <span>Runs and live log, profile, people, posts, social stats, Playbook, drafts, spend</span>
            <em>Server key only. No keys in the browser.</em>
          </div>
        </div>

        <Arrow down label="saved, then shown" />

        <div className="phase">
          <div className="phase-tag">Account page<span>no outside calls</span></div>
          <Chain>
            <Node t="supabase" title="Saved research" sub="Overview, People, Plan, Receipts" />
            <Node kind="code" title="Case studies" sub="matched to the brand's space from the Playbook" cost="no AI, free" />
          </Chain>
        </div>

        <Arrow down label="you click Draft" />

        <div className="phase">
          <div className="phase-tag">Engagement plan<span>on demand only</span></div>
          <Chain>
            <div className="group stacked">
              <Node kind="code" title="Playbook" sub="templates, proof, tone, banned phrases" />
              <Or text="+" />
              <Node t="supabase" title="Research" sub="posts, people, stats" />
            </div>
            <Node t="claude" title="Claude Sonnet 5.5" sub="picks posts, writes comments, post, notes and DMs" cost="$0.05 to $0.12 a draft" />
            <div className="loop">
              <Node kind="code" title="Server checks" sub="numbers, sources, limits, tone" />
              <span className="loop-note">fails? one redraft</span>
            </div>
            <Node kind="you" title="Copy buttons" sub="you post and send by hand" />
          </Chain>
        </div>
      </div>
      <p className="legend">
        <span><span className="node-badge sm"><IconCode /></span> our own server code, no outside call</span>
        <span><span className="swatch" /> nothing is posted, sent or connected for you</span>
      </p>
    </div>
  );
}

/* ---------------------------------- tool list -------------------------------- */

const TOOL_LIST = [
  { t: 'firecrawl', name: 'Firecrawl', does: "Searches the web and reads pages: the brand's site, news and reports." },
  { t: 'claude', name: 'Claude Opus 5.5', does: 'Pulls facts out of the pages it reads, each with a quote as its receipt.' },
  { t: 'claude', name: 'Claude Sonnet 5.5', does: 'Picks the posts and writes the comments, own post, connection notes and DMs.' },
  { t: 'apollo', name: 'Apollo', does: 'Finds the wedge personas and their team: name, title, LinkedIn and tenure.' },
  { t: 'prospeo', name: 'Prospeo', does: 'Backup people search for roles Apollo misses.' },
  { t: 'apify', name: 'Apify', does: 'Follower and post counts for Instagram, TikTok and X.' },
  { t: 'orbisearch', name: 'Orbisearch', does: 'LinkedIn company followers and employee count, through Firecrawl.' },
  { t: 'harvestapi', name: 'HarvestAPI', does: "Public LinkedIn posts from each person and the brand's page, through Firecrawl." },
  { t: 'supabase', name: 'Supabase', does: 'Stores everything: research, people, posts, the Playbook, drafts and spend.' },
  { t: 'railway', name: 'Railway', does: 'Hosts the app, the API and the background jobs.' },
];

const GUARDRAILS = [
  ['Recommends only', 'Nothing posts, comments, connects or messages on LinkedIn.'],
  ['Keys stay on the server', 'Environment variables only; never in the browser or the repo.'],
  ['Spend limits', 'Access code, 3 runs an hour per visitor, and a $25/day cap.'],
  ['No delete endpoints', 'Nothing can be deleted through the API.'],
  ['Receipts on every fact', 'Unverified claims are dropped or labeled, never shown as fact.'],
];

export function StackPage() {
  return (
    <section className="page">
      <header className="page-head">
        <h1>Stack Decisions</h1>
        <p className="muted">The tools behind the Brand Entry Tool, and how information flows through them.</p>
      </header>

      <div className="card">
        <h2>The tools</h2>
        <div className="tool-list">
          {TOOL_LIST.map((x) => (
            <div key={x.name} className="tool-item">
              <Logo t={x.t} size={32} />
              <div><strong>{x.name}</strong><span>{x.does}</span></div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>How information flows</h2><span className="muted small">From a brand name to copy you send yourself</span></div>
        <FlowDiagram />
      </div>

      <div className="card">
        <h2>Guardrails</h2>
        <div className="guardrails">
          {GUARDRAILS.map(([t, d]) => <div key={t} className="guard"><strong>{t}</strong><span>{d}</span></div>)}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------- appendix --------------------------------- */

const REN_URL = 'https://www.nectarsocial.com/ren';

export function AppendixPage() {
  return (
    <section className="page appendix">
      <header className="page-head">
        <h1>Appendix: What I Cut</h1>
        <p className="muted">What the 10-hour version adds, what the lazy version gets wrong, and the path I tried first and dropped.</p>
      </header>

      <div className="card">
        <div className="appx-head"><span className="appx-num">1</span><h2>The 10-hour version</h2></div>
        <div className="appx-points">
          <div>
            <h3>Real PDF and Loom assets</h3>
            <p>Today the DMs carry placeholders. The 10-hour version makes the actual PDF and a Loom script for each account.</p>
          </div>
          <div>
            <h3>Comment and engagement data on every post</h3>
            <p>I'd scrape the comment sections and per-post engagement to build an engagement profile for each account over time. I held back because I'm building this on my own credits, and scraping that deep costs far more than I was willing to spend on a 30-minute demo.</p>
          </div>
          <div>
            <h3>Turning the comments into talking points</h3>
            <ul>
              <li><strong>Negative, hate and spam-bot comments:</strong> what share of the comments they are, as a point to raise with the brand. Nectar's agent can hide these right away, instead of a manager spending 1 to 2 hours a day keeping the comment section clean.</li>
              <li><strong>Unanswered questions:</strong> how many comments were questions, and how many got an answer. That's where <a href={REN_URL} target="_blank" rel="noreferrer">Ren</a> comes in: a report of how many could have been answered if the brand were on Nectar.</li>
            </ul>
          </div>
          <div>
            <h3>Reddit sentiment</h3>
            <p>I'd connect the Reddit API to read what people say about new product launches. That API is hard to get access to, and Nectar already has it.</p>
          </div>
          <div>
            <h3>A much cheaper run</h3>
            <p>I'd spend real time cutting the cost per run: chaining LLM calls down to very small tasks, and sending each one only to the model it actually needs. Figuring out how to do that well takes a lot of time on its own, so for this version I kept it simple and stayed in Claude: Opus for research, Sonnet for writing. I could have split the work across many more models, but that's the 10-hour version. This is the 5-hour version.</p>
          </div>
          <div>
            <h3>With access to Nectar</h3>
            <p>If I had login access to Nectar, I'd use its own data and APIs to make this tool much better. I'd also add Meta Ads API calls to see how ad engagement performs, not just organic posts, using the same comment signals.</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="appx-head"><span className="appx-num">2</span><h2>The lazy version, wrong by half</h2></div>
        <div className="appx-points">
          <div>
            <h3>It scales, but the quality falls apart</h3>
            <p>Most comments and outreach would read like AI wrote them. Something like:</p>
            <blockquote>"Wow, awesome to see that you guys have just raised your Series B, especially considering the amount of funding that's going into the industrial space over the last 6 years."</blockquote>
            <p>Nobody actually talks like that.</p>
            <p className="instead"><strong>Instead:</strong> comments are one short, casual sentence, messages come from fixed templates, and the server flags fluff, recaps and questions.</p>
          </div>
          <div>
            <h3>Pitch-first comments</h3>
            <p>Comments and DMs that recap the post, fish for results with a question, or pitch Nectar on the first touch. It reads as AI and burns the warm-up.</p>
            <p className="instead"><strong>Instead:</strong> comments are purely engagement, just to put my face in front of the brand. The asset is offered in the connection note and delivered in the first DM.</p>
          </div>
          <div>
            <h3>Wrong-space proof</h3>
            <p>Quoting any customer's result to any brand, or inventing a number Nectar has never published.</p>
            <p className="instead"><strong>Instead:</strong> case studies are matched to the brand's space (Liquid Death and OLIPOP for an energy drink), and every number must come from the proof library, credited to the right customer.</p>
          </div>
          <div>
            <h3>It costs more, not less</h3>
            <p>Without a dedicated API for each kind of research, nothing is optimized for credit spend. The lazy version just calls the Claude API for everything and burns credits on Opus.</p>
            <p className="instead"><strong>Instead:</strong> cheap APIs do the finding and fetching, Opus only reads pages for facts, and Sonnet writes the copy.</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="appx-head"><span className="appx-num">3</span><h2>The enrichment path I tried first and dropped</h2></div>
        <div className="appx-points">
          <div>
            <h3>What I tried</h3>
            <p>Apify actors doing both jobs: search around to find each brand's social profiles, then enrich them with follower and post counts.</p>
          </div>
          <div>
            <h3>Why I dropped it</h3>
            <p>It was too much for one step. Searching until it latched onto a profile pulled in look-alike bot accounts and old official accounts the brand never deleted, some with a last post in 2016.</p>
          </div>
          <div>
            <h3>What I do now</h3>
            <p>I split the job. Firecrawl reads the brand's homepage, where the current official profiles are already linked in the footer, and pulls those links. Apify actors only enrich them (Instagram, TikTok and X), and Firecrawl's Orbisearch provider covers LinkedIn.</p>
          </div>
          <div>
            <h3>What it fixed</h3>
            <p>Cheaper runs, and only current, official accounts. Alani Nu is a good example: its Instagram, TikTok and X are all <code>alaninutrition</code>, which a search on the brand name would not reliably land on.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function IconCode() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m8 7-5 5 5 5M16 7l5 5-5 5" /></svg>; }
function IconUser() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>; }
