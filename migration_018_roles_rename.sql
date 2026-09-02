-- ============================================================
-- Миграция 018 — переименование ролей:
--   genplan  -> gip_assistant ("Помощник ГИПа")
--   designer -> engineer      ("Инженер")
-- ГИП и Помощник ГИПа теперь имеют одинаковый полный доступ (то, что
-- раньше было доступно только ГИПу — шапка проекта, "Разделы и
-- исполнители", управление пользователями — теперь доступно и ему).
-- Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

-- 1) снимаем старое ограничение, чтобы можно было обновить значения
alter table public.profiles drop constraint if exists profiles_role_check;

update public.profiles set role = 'gip_assistant' where role = 'genplan';
update public.profiles set role = 'engineer' where role = 'designer';

alter table public.profiles alter column role set default 'engineer';
alter table public.profiles add constraint profiles_role_check check (role in ('gip','gip_assistant','engineer'));

-- 2) функции, назначающие роль новому пользователю / защищающие смену роли
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first_user boolean;
begin
  select not exists(select 1 from public.profiles) into is_first_user;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email),
    case when is_first_user then 'gip' else 'engineer' end
  );
  return new;
end;
$$;

create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('gip','gip_assistant') then
    new.role := old.role;
  end if;
  return new;
end;
$$;

-- 3) RLS-политики — везде, где раньше проверялось только 'gip' (шапка проекта,
-- "Разделы и исполнители", управление пользователями) или 'gip','genplan' —
-- теперь 'gip','gip_assistant'
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update using (id = auth.uid() or public.current_user_role() in ('gip','gip_assistant'));

drop policy if exists "projects_insert" on public.projects;
create policy "projects_insert" on public.projects for insert with check (public.current_user_role() in ('gip','gip_assistant'));
drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects for update using (public.current_user_role() in ('gip','gip_assistant'));

drop policy if exists "disciplines_insert" on public.disciplines;
create policy "disciplines_insert" on public.disciplines for insert with check (public.current_user_role() in ('gip','gip_assistant'));
drop policy if exists "disciplines_update" on public.disciplines;
create policy "disciplines_update" on public.disciplines for update using (public.current_user_role() in ('gip','gip_assistant'));
drop policy if exists "disciplines_delete" on public.disciplines;
create policy "disciplines_delete" on public.disciplines for delete using (public.current_user_role() in ('gip','gip_assistant'));

drop policy if exists "discipline_assignees_insert" on public.discipline_assignees;
create policy "discipline_assignees_insert" on public.discipline_assignees for insert with check (public.current_user_role() in ('gip','gip_assistant'));
drop policy if exists "discipline_assignees_update" on public.discipline_assignees;
create policy "discipline_assignees_update" on public.discipline_assignees for update using (public.current_user_role() in ('gip','gip_assistant'));
drop policy if exists "discipline_assignees_delete" on public.discipline_assignees;
create policy "discipline_assignees_delete" on public.discipline_assignees for delete using (public.current_user_role() in ('gip','gip_assistant'));

drop policy if exists "volumes_insert" on public.volumes;
create policy "volumes_insert" on public.volumes for insert with check (public.current_user_role() in ('gip','gip_assistant'));
drop policy if exists "volumes_update" on public.volumes;
create policy "volumes_update" on public.volumes for update using (public.current_user_role() in ('gip','gip_assistant'));
drop policy if exists "volumes_delete" on public.volumes;
create policy "volumes_delete" on public.volumes for delete using (public.current_user_role() in ('gip','gip_assistant'));

drop policy if exists "positions_insert" on public.positions;
create policy "positions_insert" on public.positions for insert
  with check (public.current_user_role() in ('gip','gip_assistant'));
drop policy if exists "positions_update" on public.positions;
create policy "positions_update" on public.positions for update
  using (public.current_user_role() in ('gip','gip_assistant'));
drop policy if exists "positions_delete" on public.positions;
create policy "positions_delete" on public.positions for delete
  using (public.current_user_role() in ('gip','gip_assistant'));

drop policy if exists "position_disciplines_insert" on public.position_disciplines;
create policy "position_disciplines_insert" on public.position_disciplines for insert
  with check (public.current_user_role() in ('gip','gip_assistant'));
drop policy if exists "position_disciplines_update" on public.position_disciplines;
create policy "position_disciplines_update" on public.position_disciplines for update
  using (public.current_user_role() in ('gip','gip_assistant'));
drop policy if exists "position_disciplines_delete" on public.position_disciplines;
create policy "position_disciplines_delete" on public.position_disciplines for delete
  using (public.current_user_role() in ('gip','gip_assistant'));

drop policy if exists "documents_insert" on public.documents;
create policy "documents_insert" on public.documents for insert
  with check (
    public.has_discipline_access(discipline_code)
    or public.current_user_role() in ('gip','gip_assistant')
  );
drop policy if exists "documents_update" on public.documents;
create policy "documents_update" on public.documents for update
  using (
    public.has_discipline_access(discipline_code)
    or public.current_user_role() in ('gip','gip_assistant')
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
          or public.current_user_role() in ('gip','gip_assistant')
        )
    )
  );

drop policy if exists "sheets_insert" on public.sheets;
create policy "sheets_insert" on public.sheets for insert
  with check (
    exists (
      select 1 from public.position_disciplines pd
      where pd.id = position_discipline_id
        and (public.has_discipline_access(pd.discipline_code) or public.current_user_role() in ('gip','gip_assistant'))
    )
  );
drop policy if exists "sheets_update" on public.sheets;
create policy "sheets_update" on public.sheets for update
  using (
    exists (
      select 1 from public.position_disciplines pd
      where pd.id = position_discipline_id
        and (public.has_discipline_access(pd.discipline_code) or public.current_user_role() in ('gip','gip_assistant'))
    )
  );
drop policy if exists "sheets_delete" on public.sheets;
create policy "sheets_delete" on public.sheets for delete
  using (
    exists (
      select 1 from public.position_disciplines pd
      where pd.id = position_discipline_id
        and (public.has_discipline_access(pd.discipline_code) or public.current_user_role() in ('gip','gip_assistant'))
    )
  );
