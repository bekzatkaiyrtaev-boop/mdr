-- ============================================================
-- Миграция 037 — В чате/бегущей строке/личных сообщениях обычные права
-- одинаковые у всех (ГИП, помощник ГИПа, инженер — наравне), полные
-- права (закрепление, удаление, бан, бегущая строка, видимость чужих
-- личных переписок) — ТОЛЬКО у самого администратора по почте, а не у
-- роли ГИП/помощник ГИПа вообще (в отличие от current_user_role(),
-- который используется для остального МДР и даёт полный доступ обеим
-- этим ролям).
--
-- Выполнить в Supabase → SQL Editor ПЕРЕД выкладкой новой версии сайта
-- ============================================================

create or replace function public.is_chat_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select (select email from auth.users u where u.id = auth.uid()) = 'bekzat.kaiyrtaev@gmail.com';
$$;

-- ---------- чат ----------
drop policy if exists "chat_messages_update" on public.chat_messages;
create policy "chat_messages_update" on public.chat_messages for update
  using (public.is_chat_admin());

drop policy if exists "chat_messages_delete" on public.chat_messages;
create policy "chat_messages_delete" on public.chat_messages for delete
  using (public.is_chat_admin());

drop policy if exists "chat_banned_select" on public.chat_banned;
create policy "chat_banned_select" on public.chat_banned for select
  using (user_id = auth.uid() or public.is_chat_admin());

drop policy if exists "chat_banned_insert" on public.chat_banned;
create policy "chat_banned_insert" on public.chat_banned for insert
  with check (public.is_chat_admin());

drop policy if exists "chat_banned_delete" on public.chat_banned;
create policy "chat_banned_delete" on public.chat_banned for delete
  using (public.is_chat_admin());

-- ---------- бегущая строка ----------
drop policy if exists "app_ticker_update" on public.app_ticker;
create policy "app_ticker_update" on public.app_ticker for update
  using (public.is_chat_admin())
  with check (public.is_chat_admin());

-- ---------- личные сообщения: видимость чужой переписки — тоже только администратору ----------
drop policy if exists "direct_messages_select" on public.direct_messages;
create policy "direct_messages_select" on public.direct_messages for select
  using (sender_id = auth.uid() or recipient_id = auth.uid() or public.is_chat_admin());

drop policy if exists "direct_messages_delete" on public.direct_messages;
create policy "direct_messages_delete" on public.direct_messages for delete
  using (public.is_chat_admin());

drop policy if exists "direct_message_reactions_select" on public.direct_message_reactions;
create policy "direct_message_reactions_select" on public.direct_message_reactions for select
  using (
    exists (
      select 1 from public.direct_messages dm
      where dm.id = message_id
        and (dm.sender_id = auth.uid() or dm.recipient_id = auth.uid() or public.is_chat_admin())
    )
  );
