-- ============================================================
-- Миграция 006 — таблица "Состав разделов" (листы внутри раздела
-- позиции: наименование, формат, ревизия, комментарии/ответы, статус)
-- Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

create table public.sheets (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.positions(id) on delete cascade,
  discipline_code text not null,
  name_ru text,        -- наименование листа
  format text,          -- формат листа (А4, А3, А1...)
  revision text,
  comment text,         -- комментарии к листу
  reply text,           -- ответы на комментарии
  status text not null default 'not_started'
    check (status in ('not_started','in_progress','issued','approved','construction')),
  sort_order int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sheets enable row level security;

create policy "sheets_select" on public.sheets for select using (true);
create policy "sheets_insert" on public.sheets for insert
  with check (
    public.has_discipline_access(discipline_code)
    or public.current_user_role() in ('gip','genplan')
  );
create policy "sheets_update" on public.sheets for update
  using (
    public.has_discipline_access(discipline_code)
    or public.current_user_role() in ('gip','genplan')
  );
create policy "sheets_delete" on public.sheets for delete
  using (
    public.has_discipline_access(discipline_code)
    or public.current_user_role() in ('gip','genplan')
  );
