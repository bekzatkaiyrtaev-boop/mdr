-- ============================================================
-- Миграция 004 — какие разделы объявлены у каждой позиции
-- Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

create table public.position_disciplines (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.positions(id) on delete cascade,
  discipline_code text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (position_id, discipline_code)
);

alter table public.position_disciplines enable row level security;

create policy "position_disciplines_select" on public.position_disciplines for select using (true);
create policy "position_disciplines_insert" on public.position_disciplines for insert
  with check (public.current_user_role() in ('gip','genplan'));
create policy "position_disciplines_delete" on public.position_disciplines for delete
  using (public.current_user_role() in ('gip','genplan'));
