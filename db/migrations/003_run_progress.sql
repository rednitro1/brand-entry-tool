-- Live run progress: each module reports how far along it is (0..1) while it runs,
-- alongside its streamed log lines (run_modules.log, already present).
alter table run_modules add column if not exists progress real not null default 0;
