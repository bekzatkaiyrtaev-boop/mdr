-- ============================================================
-- Миграция 008 — тома МДР (верхний уровень, задаётся в самой вкладке MDR)
-- Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

create table public.volumes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  number text,
  name_ru text,
  name_en text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.volumes enable row level security;

create policy "volumes_select" on public.volumes for select using (true);
create policy "volumes_insert" on public.volumes for insert with check (public.current_user_role() in ('gip','genplan'));
create policy "volumes_update" on public.volumes for update using (public.current_user_role() in ('gip','genplan'));
create policy "volumes_delete" on public.volumes for delete using (public.current_user_role() in ('gip','genplan'));
