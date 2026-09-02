-- ============================================================
-- Миграция 005 — код и наименование раздела больше не обязательны
-- (можно добавить пустую строку раздела и заполнить её позже)
-- Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

alter table public.disciplines alter column code drop not null;
alter table public.disciplines alter column name_ru drop not null;
