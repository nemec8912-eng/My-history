-- «Моя история»: схема Supabase.
-- Выполнить один раз: Supabase → SQL Editor → вставить этот файл → Run.

create table if not exists public.trips (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null,
  date date not null,
  time text,
  place text,
  description text,
  cover_media_id text,
  media_ids text[] not null default '{}',
  route jsonb,
  meta jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checkpoints (
  id text primary key,
  trip_id text not null references public.trips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  position int not null,
  kind text not null check (kind in ('start','end','regular')),
  title text not null,
  description text,
  time text,
  lat double precision,
  lon double precision,
  location_label text,
  style jsonb not null,
  importance int not null default 0,
  arrived_by text,
  cover_media_id text,
  media_ids text[] not null default '{}',
  place jsonb,
  meta jsonb
);
-- Для баз, созданных раньше (без колонки meta): даты моментов, погода, метки, корзина, служебная запись.
alter table public.trips add column if not exists meta jsonb;
alter table public.checkpoints add column if not exists meta jsonb;
create index if not exists checkpoints_trip_idx on public.checkpoints(trip_id, position);

-- Медиафайл приложения. Записи дневника ссылаются только на media.id.
create table if not exists public.media (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('image','video','audio')),
  mime text not null,
  name text,
  size bigint not null default 0,
  width int,
  height int,
  created_at timestamptz not null default now()
);

-- Где физически лежит файл. Перенос хранилища = новые строки здесь, media.id не меняется.
create table if not exists public.media_storage (
  media_id text not null references public.media(id) on delete cascade,
  variant text not null check (variant in ('original','thumb')),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  provider text not null,            -- 'supabase' | 'gdrive' | ...
  location jsonb not null,           -- supabase: {bucket, path}; gdrive: {accountId, fileId}
  size bigint,
  checksum text,
  status text not null default 'ok', -- ok | copying | verified | pending_delete
  created_at timestamptz not null default now(),
  primary key (media_id, variant, provider)
);

alter table public.trips enable row level security;
alter table public.checkpoints enable row level security;
alter table public.media enable row level security;
alter table public.media_storage enable row level security;

do $$
declare t text;
begin
  foreach t in array array['trips','checkpoints','media','media_storage'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;

-- Хранилище файлов: приватный bucket, каждый пользователь видит только свою папку <uid>/...
insert into storage.buckets (id, name, public) values ('media', 'media', false)
on conflict (id) do nothing;

drop policy if exists "media own folder" on storage.objects;
create policy "media own folder" on storage.objects for all
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
