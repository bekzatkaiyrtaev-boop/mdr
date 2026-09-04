-- ============================================================
-- Миграция 023 — разрешить инженерам создавать альбомы (разделы в позициях/томах)
-- по своим разделам во вкладке "Создание разделов".
--
-- Раньше position_disciplines можно было менять только ГИПу/помощнику ГИПа.
-- Теперь инженеру тоже можно — но только для discipline_code, где он значится
-- исполнителем (public.has_discipline_access, та же проверка, что уже
-- используется для листов в public.sheets).
--
-- Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

drop policy if exists "position_disciplines_insert" on public.position_disciplines;
create policy "position_disciplines_insert" on public.position_disciplines for insert
  with check (
    public.current_user_role() in ('gip','gip_assistant')
    or public.has_discipline_access(discipline_code)
  );

drop policy if exists "position_disciplines_update" on public.position_disciplines;
create policy "position_disciplines_update" on public.position_disciplines for update
  using (
    public.current_user_role() in ('gip','gip_assistant')
    or public.has_discipline_access(discipline_code)
  )
  with check (
    public.current_user_role() in ('gip','gip_assistant')
    or public.has_discipline_access(discipline_code)
  );

drop policy if exists "position_disciplines_delete" on public.position_disciplines;
create policy "position_disciplines_delete" on public.position_disciplines for delete
  using (
    public.current_user_role() in ('gip','gip_assistant')
    or public.has_discipline_access(discipline_code)
  );
