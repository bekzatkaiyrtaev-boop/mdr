-- ============================================================
-- Миграция 003 — разрешить удаление позиций (генплан/ГИП)
-- Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

create policy "positions_delete" on public.positions for delete
  using (public.current_user_role() in ('gip','genplan'));
