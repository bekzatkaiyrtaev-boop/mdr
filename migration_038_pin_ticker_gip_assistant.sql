-- ============================================================
-- Миграция 038 — Закрепление сообщения и бегущая строка снова доступны
-- ГИП и помощнику ГИПа наравне с администратором (как и было до
-- миграции 037), а не только самому администратору. Удаление сообщения
-- и бан из чата по-прежнему только у администратора — это не трогаем.
--
-- Выполнить в Supabase → SQL Editor ПЕРЕД выкладкой новой версии сайта
-- ============================================================

drop policy if exists "chat_messages_update" on public.chat_messages;
create policy "chat_messages_update" on public.chat_messages for update
  using (public.current_user_role() in ('gip','gip_assistant'));

drop policy if exists "app_ticker_update" on public.app_ticker;
create policy "app_ticker_update" on public.app_ticker for update
  using (public.current_user_role() in ('gip','gip_assistant'))
  with check (public.current_user_role() in ('gip','gip_assistant'));
