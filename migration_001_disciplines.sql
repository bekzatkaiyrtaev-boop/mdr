-- ============================================================
-- Миграция 001 — таблица "Разделы и исполнители" вместо profiles.disciplines
-- Выполнить в Supabase → SQL Editor на уже созданном проекте (после schema.sql)
-- ============================================================

create table public.disciplines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  code text not null,
  name_ru text not null,
  name_en text,
  assigned_name text,
  assigned_email text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.disciplines enable row level security;

create policy "disciplines_select" on public.disciplines for select using (true);
create policy "disciplines_insert" on public.disciplines for insert with check (public.current_user_role() = 'gip');
create policy "disciplines_update" on public.disciplines for update using (public.current_user_role() = 'gip');
create policy "disciplines_delete" on public.disciplines for delete using (public.current_user_role() = 'gip');

create or replace function public.has_discipline_access(p_code text)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.disciplines d, public.profiles p
    where p.id = auth.uid()
      and d.code = p_code
      and lower(d.assigned_email) = lower(p.email)
  );
$$;

drop policy if exists "documents_insert" on public.documents;
create policy "documents_insert" on public.documents for insert
  with check (
    public.has_discipline_access(discipline_code)
    or public.current_user_role() in ('gip','genplan')
  );

drop policy if exists "documents_update" on public.documents;
create policy "documents_update" on public.documents for update
  using (
    public.has_discipline_access(discipline_code)
    or public.current_user_role() in ('gip','genplan')
    or created_by = auth.uid()
  );

drop policy if exists "revision_events_insert" on public.revision_events;
create policy "revision_events_insert" on public.revision_events for insert
  with check (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and (
          public.has_discipline_access(d.discipline_code)
          or public.current_user_role() in ('gip','genplan')
        )
    )
  );

-- старая функция/колонка больше не используются
drop function if exists public.current_user_disciplines();
alter table public.profiles drop column if exists disciplines;

-- защита от самоповышения роли — упрощена (раздел больше не хранится в profiles)
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'gip' then
    new.role := old.role;
  end if;
  return new;
end;
$$;
