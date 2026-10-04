-- «Моя история»: необязательные поля для дат и погоды моментов, даты окончания поездки.
-- Обратно совместимо: колонки необязательные, старые записи не меняются.
-- Выполнить: Supabase → SQL Editor → вставить → Run.
alter table public.trips add column if not exists meta jsonb;
alter table public.checkpoints add column if not exists meta jsonb;
