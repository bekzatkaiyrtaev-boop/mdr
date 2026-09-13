-- ============================================================
-- Миграция 027 — несколько исполнителей у одного поручения.
-- Раньше assignments.assignee_id — один сотрудник. Заводим отдельную
-- таблицу assignment_assignees (по аналогии с discipline_assignees —
-- "Разделы и исполнители"), переносим уже назначенных исполнителей туда
-- и убираем старую колонку.
-- Безопасно выполнять повторно (если запрос уже выполнялся один раз).
-- Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

create table if not exists public.assignment_assignees (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.assignment_assignees enable row level security;

drop policy if exists "assignment_assignees_select" on public.assignment_assignees;
create policy "assignment_assignees_select" on public.assignment_assignees for select using (true);
drop policy if exists "assignment_assignees_insert" on public.assignment_assignees;
create policy "assignment_assignees_insert" on public.assignment_assignees for insert with check (public.current_user_role() in ('gip','gip_assistant'));
drop policy if exists "assignment_assignees_update" on public.assignment_assignees;
create policy "assignment_assignees_update" on public.assignment_assignees for update using (public.current_user_role() in ('gip','gip_assistant'));
drop policy if exists "assignment_assignees_delete" on public.assignment_assignees;
create policy "assignment_assignees_delete" on public.assignment_assignees for delete using (public.current_user_role() in ('gip','gip_assistant'));

-- переносим уже назначенных единственных исполнителей и убираем старую колонку — только если
-- колонка assignee_id ещё существует (если миграция уже отработала раньше — просто пропускаем)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'assignments' and column_name = 'assignee_id'
  ) then
    insert into public.assignment_assignees (assignment_id, employee_id)
    select id, assignee_id from public.assignments where assignee_id is not null;

    alter table public.assignments drop column assignee_id;
  end if;
end $$;
