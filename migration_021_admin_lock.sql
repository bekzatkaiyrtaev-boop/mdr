-- ============================================================
-- Миграция 021 — жёстко закреплённый администратор по email.
--
-- Пользователь bekzat.kaiyrtaev@gmail.com всегда имеет полные права (как
-- ГИП), независимо от того, что записано в profiles.role — current_user_role()
-- для этого email всегда возвращает 'gip'. Триггер на profiles дополнительно
-- принудительно возвращает role='gip', даже если кто-то (в т.ч. другой ГИП)
-- попробует сменить её через API/UI.
--
-- Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

create or replace function public.current_user_role()
returns text
language sql security definer stable
set search_path = public
as $$
  select case
    when (select email from auth.users u where u.id = auth.uid()) = 'bekzat.kaiyrtaev@gmail.com' then 'gip'
    else (select role from public.profiles where id = auth.uid())
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
  -- закреплённый администратор — роль всегда 'gip', её нельзя сменить никаким путём
  if (select email from auth.users where id = new.id) = 'bekzat.kaiyrtaev@gmail.com' then
    new.role := 'gip';
  end if;
  return new;
end;
$$;

-- на всякий случай сразу привести в порядок то, что уже сохранено
update public.profiles set role = 'gip'
where id = (select id from auth.users where email = 'bekzat.kaiyrtaev@gmail.com');
update public.employees set role = 'gip'
where lower(email) = 'bekzat.kaiyrtaev@gmail.com';
