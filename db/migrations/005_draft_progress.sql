-- Live log + progress for engagement drafts, like run_modules has for research runs.
alter table strategies add column if not exists log jsonb not null default '[]'::jsonb;
alter table strategies add column if not exists progress numeric not null default 0;
