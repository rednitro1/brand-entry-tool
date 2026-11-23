-- Brand Entry Tool schema. Core object is the brand.
-- Every fact-bearing row carries source_url + verification so the UI can show receipts
-- and never present an unverified claim as fact.
-- RLS is enabled on every table with NO policies: only the server's service-role key
-- can read or write. The browser never talks to Supabase directly.

create type verification_label as enum ('verified', 'single_source', 'inferred', 'vendor_claim', 'unverified');
create type run_status as enum ('queued', 'running', 'done', 'partial', 'failed');
create type module_status as enum ('queued', 'running', 'done', 'skipped', 'failed');

create table brands (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,               -- e.g. 'alani-nu'
  name          text not null,
  domain        text,
  linkedin_url  text,
  is_example    boolean not null default false,     -- cached demo brands load without a live run
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table runs (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid references brands(id) on delete cascade,
  input         text not null,                      -- what the user typed
  status        run_status not null default 'queued',
  ip_hash       text,                               -- salted hash, never the raw IP
  cost_usd      numeric(10,4) not null default 0,
  error         text,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index runs_created_at_idx on runs (created_at);
create index runs_brand_idx on runs (brand_id, created_at desc);

create table run_modules (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references runs(id) on delete cascade,
  module        text not null,                      -- resolve | profile | stakeholders | social:instagram | ... | strategy
  status        module_status not null default 'queued',
  cost_usd      numeric(10,4) not null default 0,
  detail        jsonb not null default '{}'::jsonb, -- provider calls, counts, cost breakdown
  log           text[] not null default '{}',
  error         text,
  started_at    timestamptz,
  finished_at   timestamptz,
  unique (run_id, module)
);

create table brand_profiles (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  run_id        uuid references runs(id) on delete set null,
  summary       text not null,
  facts         jsonb not null default '[]'::jsonb, -- [{claim, url, quote, label, kind: 'acquisition'|'launch'|'leadership'|'financial'|'other', date}]
  conflicts     jsonb not null default '[]'::jsonb, -- [{topic, sources:[{url, says}], resolution}]
  sources       jsonb not null default '[]'::jsonb, -- [{url, title, kind: 'primary'|'press'|'vendor'|'other'}]
  created_at    timestamptz not null default now()
);

create table stakeholders (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references brands(id) on delete cascade,
  run_id           uuid references runs(id) on delete set null,
  full_name        text not null,
  title            text,                            -- always from the profile, never secondhand notes
  persona          text,                            -- cmo | director_social | chief_digital | director_cx | team | other
  linkedin_url     text,
  tenure_months    integer,
  started_role_at  date,
  started_company_at date,
  note             text,                            -- short evidence-backed note
  evidence         jsonb not null default '[]'::jsonb,
  found_via        text,                            -- apollo | prospeo | fixture | firecrawl
  verification     verification_label not null default 'single_source',
  created_at       timestamptz not null default now()
);
create index stakeholders_brand_idx on stakeholders (brand_id);

create table stakeholder_posts (
  id               uuid primary key default gen_random_uuid(),
  stakeholder_id   uuid not null references stakeholders(id) on delete cascade,
  url              text not null,
  posted_at        timestamptz,
  text             text,
  is_repost        boolean not null default false,
  reactions        integer,
  comments         integer,
  topic            text,                            -- promotion | team | company_win | tactics | other
  created_at       timestamptz not null default now(),
  unique (stakeholder_id, url)
);

create table social_accounts (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references brands(id) on delete cascade,
  platform         text not null,                   -- instagram | tiktok | x | linkedin
  handle           text not null,
  url              text not null,
  followers        bigint,
  following        bigint,
  post_count       bigint,
  stats_source     text,                            -- actor / provider that returned the counts
  captured_at      timestamptz,
  error            text,
  unique (brand_id, platform)
);

create table social_posts (
  id                 text not null,                 -- platform-native post id
  social_account_id  uuid not null references social_accounts(id) on delete cascade,
  url                text not null,
  type               text,                          -- image | video | carousel | reel | text
  caption            text,
  posted_at          timestamptz,
  likes              bigint,                        -- null = hidden / unknown, never 0
  likes_hidden       boolean not null default false,
  comments           bigint,
  views              bigint,
  shares             bigint,
  is_sponsored       boolean not null default false,
  is_collab          boolean not null default false,
  primary key (social_account_id, id)
);

-- Append-only: one row per post per scrape, so velocity / over-time charts work.
create table post_metric_snapshots (
  id                 bigserial primary key,
  social_account_id  uuid not null,
  post_id            text not null,
  captured_at        timestamptz not null default now(),
  likes              bigint,
  comments           bigint,
  views              bigint,
  shares             bigint,
  foreign key (social_account_id, post_id) references social_posts(social_account_id, id) on delete cascade
);
create index pms_post_idx on post_metric_snapshots (social_account_id, post_id, captured_at);

create table strategies (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references brands(id) on delete cascade,
  run_id           uuid references runs(id) on delete set null,
  model            text not null,
  output           jsonb not null,                  -- validated {lead, comment, connection_note, gaps}
  rejected_claims  jsonb not null default '[]'::jsonb, -- claims dropped by evidence validation
  input_tokens     integer,
  output_tokens    integer,
  created_at       timestamptz not null default now()
);

alter table brands enable row level security;
alter table runs enable row level security;
alter table run_modules enable row level security;
alter table brand_profiles enable row level security;
alter table stakeholders enable row level security;
alter table stakeholder_posts enable row level security;
alter table social_accounts enable row level security;
alter table social_posts enable row level security;
alter table post_metric_snapshots enable row level security;
alter table strategies enable row level security;
