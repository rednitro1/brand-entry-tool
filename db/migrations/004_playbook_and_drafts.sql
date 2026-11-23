-- Part 2: warm-up + first touch.

-- Copywriting context the drafts are grounded in. Every save is a new row; the latest wins,
-- so earlier versions stay readable and nothing is overwritten.
create table if not exists playbooks (
  id          uuid primary key default gen_random_uuid(),
  content     jsonb not null,
  note        text,
  created_at  timestamptz not null default now()
);
alter table playbooks enable row level security;

-- Brand LinkedIn page posts live in social_posts (under the brand's linkedin account row).
alter table social_posts add column if not exists is_repost boolean not null default false;
alter table social_posts add column if not exists author text;
alter table social_posts add column if not exists captured_at timestamptz not null default now();

-- Engagement drafts reuse strategies: one row per draft, drafted in the background.
alter table strategies add column if not exists status text not null default 'done';   -- running | done | failed
alter table strategies add column if not exists error text;
alter table strategies add column if not exists cost_usd numeric not null default 0;
alter table strategies add column if not exists picks jsonb not null default '[]'::jsonb;
alter table strategies add column if not exists playbook_id uuid references playbooks(id) on delete set null;
alter table strategies add column if not exists finished_at timestamptz;
