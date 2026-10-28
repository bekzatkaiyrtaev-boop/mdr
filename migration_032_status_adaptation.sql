-- ============================================================
-- Миграция 032 — новый статус листа «На адаптации» (adaptation),
-- идёт сразу после «Возвращен на доработку HBEC».
-- Выполнить в Supabase → SQL Editor ПЕРЕД выкладкой новой версии сайта
-- ============================================================

alter table public.sheets drop constraint if exists sheets_status_check;
alter table public.sheets add constraint sheets_status_check
  check (status in ('not_started','received_hbec','returned_hbec','adaptation','sent_electronic','sent_paper'));
