-- ============================================================
-- Миграция 035 — Бегущая строка приложения. Одна строка-синглтон:
-- администратор (ГИП/помощник ГИПа) запускает текст (вручную или кнопкой
-- у сообщения в чате), он показывается внизу экрана на ЛЮБОЙ вкладке МДР,
-- не только в чате. По умолчанию выключается сама через 24 часа
-- (expires_at) — строка в таблице при этом остаётся, просто перестаёт
-- считаться активной (проверка на клиенте, т.к. нет бэкенда для
-- отложенного удаления по расписанию).
--
-- Читать может любой вошедший пользователь (включая наблюдателя — это
-- общее объявление, а не часть чата), писать — только администратор.
--
-- Выполнить в Supabase → SQL Editor ПЕРЕД выкладкой новой версии сайта
-- ============================================================

create table public.app_ticker (
  id text primary key default 'main',
  text text,
  author_name text,
  active boolean not null default false,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.app_ticker (id) values ('main') on conflict (id) do nothing;

alter table public.app_ticker enable row level security;

create policy "app_ticker_select" on public.app_ticker for select using (true);
create policy "app_ticker_update" on public.app_ticker for update
  using (public.current_user_role() in ('gip','gip_assistant'))
  with check (public.current_user_role() in ('gip','gip_assistant'));

alter publication supabase_realtime add table public.app_ticker;
