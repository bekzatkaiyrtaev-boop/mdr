-- ============================================================
-- Миграция 018 — справочник сотрудников (public.employees).
--
-- Раньше исполнителей раздела заводили как свободный текст (ФИО + email)
-- прямо в "Разделы и исполнители" — то есть сотрудника нельзя было завести
-- заранее, до того как он попадёт в какой-то раздел. Теперь: единый список
-- сотрудников (Имя, Email, Роль) задаётся во вкладке "Пользователи", а в
-- "Разделы и исполнители" выбирают исполнителя из выпадающего списка по
-- имени — email там больше не вводится.
--
-- При регистрации нового пользователя (auth) — если его email уже есть в
-- employees, роль и ФИО подтягиваются оттуда, а не сбрасываются в "Инженер".
--
-- Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  role text not null default 'engineer' check (role in ('gip','gip_assistant','engineer')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create unique index employees_email_unique on public.employees (lower(email));

alter table public.employees enable row level security;

create policy "employees_select" on public.employees for select using (true);
create policy "employees_insert" on public.employees for insert with check (public.current_user_role() in ('gip','gip_assistant'));
create policy "employees_update" on public.employees for update using (public.current_user_role() in ('gip','gip_assistant'));
create policy "employees_delete" on public.employees for delete using (public.current_user_role() in ('gip','gip_assistant'));

-- === переносим уже существующих исполнителей/пользователей в новый справочник ===

-- 1) из уже зарегистрированных profiles
insert into public.employees (full_name, email, role)
select coalesce(p.full_name, p.email), lower(p.email), p.role
from public.profiles p
where p.email is not null and p.email <> ''
on conflict do nothing;

-- 2) из ещё не зарегистрированных исполнителей (assigned_email в discipline_assignees)
insert into public.employees (full_name, email, role)
select distinct on (lower(da.assigned_email))
  coalesce(nullif(da.assigned_name, ''), split_part(da.assigned_email, '@', 1)),
  lower(da.assigned_email),
  'engineer'
from public.discipline_assignees da
where da.assigned_email is not null and da.assigned_email <> ''
  and not exists (select 1 from public.employees e where lower(e.email) = lower(da.assigned_email))
on conflict do nothing;

-- === добавляем employee_id и переносим на него существующие привязки ===

alter table public.discipline_assignees add column if not exists employee_id uuid references public.employees(id) on delete set null;

update public.discipline_assignees da
set employee_id = e.id
from public.employees e
where da.employee_id is null
  and da.assigned_email is not null and da.assigned_email <> ''
  and lower(e.email) = lower(da.assigned_email);

-- старые свободнотекстовые поля больше не используются — их заменил employee_id
alter table public.discipline_assignees drop column if exists assigned_name;
alter table public.discipline_assignees drop column if exists assigned_email;

-- === RLS-доступ к разделу теперь проверяется через employees, а не текстовый email ===
create or replace function public.has_discipline_access(p_code text)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
    from public.disciplines d
    join public.discipline_assignees da on da.discipline_id = d.id
    join public.employees e on e.id = da.employee_id
    join public.profiles p on p.id = auth.uid()
    where d.code = p_code
      and lower(e.email) = lower(p.email)
  );
$$;

-- === при регистрации — если сотрудник уже заведён в employees, берём его имя/роль оттуда ===
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first_user boolean;
  pre_role text;
  pre_name text;
begin
  select not exists(select 1 from public.profiles) into is_first_user;
  select role, full_name into pre_role, pre_name
    from public.employees where lower(email) = lower(new.email) limit 1;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id, new.email,
    coalesce(pre_name, new.raw_user_meta_data->>'full_name', new.email),
    coalesce(pre_role, case when is_first_user then 'gip' else 'engineer' end)
  );
  return new;
end;
$$;
