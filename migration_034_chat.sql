-- ============================================================
-- Миграция 034 — Чат. Общий чат внутри приложения: реакции (эмодзи),
-- ответ на сообщение (цитата), закрепление администратором (ГИП/помощник
-- ГИПа), бан конкретного пользователя из чата (не трогает его роль/права
-- в остальном МДР — отдельный список, как и остальные права, проверяется
-- на уровне базы, а не только в интерфейсе).
--
-- Наблюдатель (viewer) к чату не допускается вовсе — ни читать, ни писать
-- (как и остальные вкладки МДР, кроме самой MDR).
--
-- Выполнить в Supabase → SQL Editor ПЕРЕД выкладкой новой версии сайта
-- ============================================================

-- ---------- сообщения чата ----------
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete set null,
  text text not null,
  reply_to_id uuid references public.chat_messages(id) on delete set null,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

-- одновременно закреплено не больше одного сообщения
create unique index chat_messages_pinned_unique on public.chat_messages ((pinned)) where pinned;

alter table public.chat_messages enable row level security;

-- ---------- чёрный список чата (не связан с ролью/правами в остальном МДР) ----------
create table public.chat_banned (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  banned_at timestamptz not null default now(),
  banned_by uuid references public.profiles(id)
);

alter table public.chat_banned enable row level security;

create policy "chat_banned_select" on public.chat_banned for select
  using (user_id = auth.uid() or public.current_user_role() in ('gip','gip_assistant'));
create policy "chat_banned_insert" on public.chat_banned for insert
  with check (public.current_user_role() in ('gip','gip_assistant'));
create policy "chat_banned_delete" on public.chat_banned for delete
  using (public.current_user_role() in ('gip','gip_assistant'));

-- писать в чат может любой, кроме наблюдателя и забаненного
create or replace function public.can_use_chat()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select public.current_user_role() <> 'viewer'
    and not exists (select 1 from public.chat_banned where user_id = auth.uid());
$$;

create policy "chat_messages_select" on public.chat_messages for select
  using (public.current_user_role() <> 'viewer');
create policy "chat_messages_insert" on public.chat_messages for insert
  with check (author_id = auth.uid() and public.can_use_chat());
-- редактирует (в т.ч. закрепляет/открепляет) только администратор — как и остальные
-- таблицы этой схемы, без постолбцового ограничения на уровне RLS
create policy "chat_messages_update" on public.chat_messages for update
  using (public.current_user_role() in ('gip','gip_assistant'));
create policy "chat_messages_delete" on public.chat_messages for delete
  using (public.current_user_role() in ('gip','gip_assistant'));

-- ---------- реакции (эмодзи) — одна реакция на пользователя на сообщение ----------
create table public.chat_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  constraint chat_reactions_unique unique (message_id, user_id)
);

alter table public.chat_reactions enable row level security;

create policy "chat_reactions_select" on public.chat_reactions for select
  using (public.current_user_role() <> 'viewer');
create policy "chat_reactions_insert" on public.chat_reactions for insert
  with check (user_id = auth.uid() and public.can_use_chat());
create policy "chat_reactions_update" on public.chat_reactions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "chat_reactions_delete" on public.chat_reactions for delete
  using (user_id = auth.uid());

-- ---------- realtime (чтобы сообщения/реакции появлялись без обновления страницы) ----------
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.chat_reactions;
alter publication supabase_realtime add table public.chat_banned;
