-- ============================================================
-- Миграция 007 — несколько исполнителей на раздел + права доступа по ним.
-- Отложена на потом (см. migration_007a_volume_number.sql — номер тома/книги
-- выполнен отдельно и раньше). Выполнить, когда дойдёт очередь до исполнителей.
-- Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

create table public.discipline_assignees (
  id uuid primary key default gen_random_uuid(),
  discipline_id uuid not null references public.disciplines(id) on delete cascade,
  assigned_name text,
  assigned_email text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.discipline_assignees enable row level security;

create policy "discipline_assignees_select" on public.discipline_assignees for select using (true);
create policy "discipline_assignees_insert" on public.discipline_assignees for insert with check (public.current_user_role() = 'gip');
create policy "discipline_assignees_update" on public.discipline_assignees for update using (public.current_user_role() = 'gip');
create policy "discipline_assignees_delete" on public.discipline_assignees for delete using (public.current_user_role() = 'gip');

-- переносим уже заведённых (по одному на раздел) исполнителей в новую таблицу
insert into public.discipline_assignees (discipline_id, assigned_name, assigned_email, created_by)
select id, assigned_name, assigned_email, created_by
from public.disciplines
where coalesce(assigned_name, '') <> '' or coalesce(assigned_email, '') <> '';

alter table public.disciplines drop column assigned_name;
alter table public.disciplines drop column assigned_email;

-- проверка доступа к разделу теперь смотрит во все привязанные email в discipline_assignees
create or replace function public.has_discipline_access(p_code text)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
    from public.disciplines d
    join public.discipline_assignees da on da.discipline_id = d.id
    join public.profiles p on p.id = auth.uid()
    where d.code = p_code
      and lower(da.assigned_email) = lower(p.email)
  );
$$;
