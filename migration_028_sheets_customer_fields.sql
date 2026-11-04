-- ============================================================
-- Миграция 028 — "Обозначение заказчика" и "Ревизия заказчика" у листа
-- (public.sheets.customer_designation / customer_revision).
--
-- Задаются во вкладке "Состав разделов" (два столбца справа), в MDR
-- отображаются справа от "Редакции". Выполнить в Supabase → SQL Editor
-- ============================================================

alter table public.sheets add column if not exists customer_designation text;
alter table public.sheets add column if not exists customer_revision text;
