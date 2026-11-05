-- ============================================================
-- Миграция 036 — Личные сообщения (1:1). Список участников слева от
-- общего чата: любой зарегистрированный, кроме наблюдателя (та же
-- граница доступа, что и у общего чата). Только текст и реакции —
-- без ответов-цитат и закрепления, в отличие от общего чата.
--
-- Переписку видят только сам диалог (отправитель/получатель) и
-- администратор (ГИП/помощник ГИПа) — как и весь остальной МДР, права
-- проверяются на уровне базы.
--
-- Выполнить в Supabase → SQL Editor ПЕРЕД выкладкой новой версии сайта
-- ============================================================

create table public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now(),
  constraint direct_messages_not_self check (sender_id <> recipient_id)
);

alter table public.direct_messages enable row level security;

create policy "direct_messages_select" on public.direct_messages for select
  using (
    sender_id = auth.uid() or recipient_id = auth.uid()
    or public.current_user_role() in ('gip','gip_assistant')
  );
create policy "direct_messages_insert" on public.direct_messages for insert
  with check (
    sender_id = auth.uid()
    and public.can_use_chat()
    and (select role from public.profiles where id = recipient_id) <> 'viewer'
  );
create policy "direct_messages_delete" on public.direct_messages for delete
  using (public.current_user_role() in ('gip','gip_assistant'));

-- ---------- реакции на личные сообщения — та же логика, что и в общем чате ----------
create table public.direct_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  constraint direct_message_reactions_unique unique (message_id, user_id)
);

alter table public.direct_message_reactions enable row level security;

create policy "direct_message_reactions_select" on public.direct_message_reactions for select
  using (
    exists (
      select 1 from public.direct_messages dm
      where dm.id = message_id
        and (dm.sender_id = auth.uid() or dm.recipient_id = auth.uid()
             or public.current_user_role() in ('gip','gip_assistant'))
    )
  );
create policy "direct_message_reactions_insert" on public.direct_message_reactions for insert
  with check (
    user_id = auth.uid() and public.can_use_chat()
    and exists (
      select 1 from public.direct_messages dm
      where dm.id = message_id and (dm.sender_id = auth.uid() or dm.recipient_id = auth.uid())
    )
  );
create policy "direct_message_reactions_update" on public.direct_message_reactions for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "direct_message_reactions_delete" on public.direct_message_reactions for delete
  using (user_id = auth.uid());

alter publication supabase_realtime add table public.direct_messages;
alter publication supabase_realtime add table public.direct_message_reactions;
