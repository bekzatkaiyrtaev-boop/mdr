-- ============================================================
-- Миграция 019 — вкладка "Поручения" (public.assignments).
-- Автор и Исполнитель — ссылки на справочник сотрудников (public.employees),
-- см. миграцию 018. Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  text text,                    -- "Поручение"
  basis text,                   -- "Основание"
  author_id uuid references public.employees(id) on delete set null,
  assignee_id uuid references public.employees(id) on delete set null,
  issued_date date,             -- "Дата выдачи"
  deadline date,                -- "Дедлайн"
  status text not null default 'not_started' check (status in ('not_started','in_progress','done','cancelled')),
  note text,                    -- "Примечание"
  sort_order int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.assignments enable row level security;

create policy "assignments_select" on public.assignments for select using (true);
create policy "assignments_insert" on public.assignments for insert with check (public.current_user_role() in ('gip','gip_assistant'));
create policy "assignments_update" on public.assignments for update using (public.current_user_role() in ('gip','gip_assistant'));
create policy "assignments_delete" on public.assignments for delete using (public.current_user_role() in ('gip','gip_assistant'));
