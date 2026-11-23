-- Fields the built modules produce that 001 didn't anticipate. Tables are empty, so the
-- summary type change is safe.
alter table brand_profiles alter column summary type jsonb using to_jsonb(summary);
alter table brand_profiles add column ownership jsonb not null default '{}'::jsonb;
alter table brand_profiles add column reporting jsonb not null default '{}'::jsonb;
alter table brand_profiles add column rejected jsonb not null default '[]'::jsonb;
alter table brand_profiles add column cost jsonb not null default '{}'::jsonb;

alter table stakeholders add column company_tenure_months integer;
alter table stakeholders add column post_pattern jsonb;

alter table social_accounts add column extra jsonb not null default '{}'::jsonb;
alter table brands add column socials jsonb not null default '{}'::jsonb;
alter table brands add column gaps jsonb not null default '[]'::jsonb;
