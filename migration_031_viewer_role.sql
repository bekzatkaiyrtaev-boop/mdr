-- ============================================================
-- Миграция 031 — роль «Наблюдатель» (viewer): гость, видит только вкладку MDR,
-- только чтение. Записать что-либо он не может: все политики записи
-- (positions, volumes, disciplines, position_disciplines, sheets, assignments и др.)
-- пускают только ГИП, помощника ГИПа и исполнителей своих разделов.
--
-- Как выдать доступ: Пользователи → «+ Добавить сотрудника» (имя, email) →
-- роль «Наблюдатель» → гость регистрируется на сайте по этому email.
-- Не назначайте наблюдателя исполнителем раздела — исполнитель получает право записи.
--
-- Выполнить в Supabase → SQL Editor
-- ============================================================

do $$
declare c record;
begin
  for c in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.profiles'::regclass, 'public.employees'::regclass)
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

alter table public.profiles  add constraint profiles_role_check
  check (role in ('gip','gip_assistant','engineer','viewer'));
alter table public.employees add constraint employees_role_check
  check (role in ('gip','gip_assistant','engineer','viewer'));
