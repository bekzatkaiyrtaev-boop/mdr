-- ============================================================
-- Миграция 014 — колонка "Номер тома / номер альбома" (ручное поле,
-- пока нигде не участвует в расчётах/нумерации — просто для заметок).
-- У томов своего такого поля нет — у них номер уже есть в колонке
-- volumes.number, которая теперь и отображается в этой колонке в MDR.
-- Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

alter table public.positions add column if not exists manual_number text;
alter table public.position_disciplines add column if not exists manual_number text;
alter table public.sheets add column if not exists manual_number text;
