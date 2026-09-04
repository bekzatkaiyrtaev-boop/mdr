-- ============================================================
-- Миграция 026 — ФИО ГИПа в реквизитах для титульного листа
-- (project.gip_name_ru / project.gip_name_en). Если поле не заполнено —
-- титул по-прежнему подставляет имя автоматически (роль ГИП среди
-- зарегистрированных пользователей либо справочник employees).
-- Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

alter table public.projects add column if not exists gip_name_ru text;
alter table public.projects add column if not exists gip_name_en text;
