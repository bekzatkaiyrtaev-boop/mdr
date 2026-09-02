-- ============================================================
-- Миграция 012 — разделяем "раздел" (АС/КМ/КЖ, с исполнителями, один на весь код)
-- и "альбом" (конкретный экземпляр раздела в позиции — КЖ1, КЖ2, у каждого свой шифр/примечание).
-- Раньше повтор раздела создавал новую независимую запись в disciplines
-- со своими исполнителями — это было неправильно, теперь это просто новая
-- строка в position_disciplines, ссылающаяся на тот же раздел.
--
-- ВАЖНО: если вы уже успели создать тестовые повторяющиеся разделы (КЖ1, КЖ2, КЖ3
-- как отдельные записи в disciplines) — проще всего удалить их и завести заново
-- через "+ Добавить строку" в MDR, уже по новой логике. Это тестовые данные,
-- откатывать их автоматически рискованно, поэтому миграция это не делает.
--
-- Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

alter table public.position_disciplines add column if not exists marker text;
alter table public.position_disciplines add column if not exists note text;
alter table public.position_disciplines drop constraint if exists position_disciplines_position_id_discipline_code_key;

drop policy if exists "position_disciplines_update" on public.position_disciplines;
create policy "position_disciplines_update" on public.position_disciplines for update
  using (public.current_user_role() in ('gip','genplan'));

alter table public.sheets add column if not exists position_discipline_id uuid references public.position_disciplines(id) on delete cascade;

drop policy if exists "sheets_insert" on public.sheets;
create policy "sheets_insert" on public.sheets for insert
  with check (
    exists (
      select 1 from public.position_disciplines pd
      where pd.id = position_discipline_id
        and (public.has_discipline_access(pd.discipline_code) or public.current_user_role() in ('gip','genplan'))
    )
  );

drop policy if exists "sheets_update" on public.sheets;
create policy "sheets_update" on public.sheets for update
  using (
    exists (
      select 1 from public.position_disciplines pd
      where pd.id = position_discipline_id
        and (public.has_discipline_access(pd.discipline_code) or public.current_user_role() in ('gip','genplan'))
    )
  );

drop policy if exists "sheets_delete" on public.sheets;
create policy "sheets_delete" on public.sheets for delete
  using (
    exists (
      select 1 from public.position_disciplines pd
      where pd.id = position_discipline_id
        and (public.has_discipline_access(pd.discipline_code) or public.current_user_role() in ('gip','genplan'))
    )
  );
