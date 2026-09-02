-- ============================================================
-- Миграция 010 — порядок разделов внутри позиции (для нумерации в MDR)
-- Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

alter table public.position_disciplines add column if not exists sort_order int not null default 0;
