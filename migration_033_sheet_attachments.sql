-- ============================================================
-- Миграция 033 — «Прилагаемые документы» альбома: листы с признаком is_attachment
-- и своим обозначением (attachment_designation). В «Составе разделов» и MDR идут
-- в конце альбома после листов, выделены цветом.
-- Выполнить в Supabase → SQL Editor ПЕРЕД выкладкой новой версии сайта
-- ============================================================

alter table public.sheets add column if not exists is_attachment boolean not null default false;
alter table public.sheets add column if not exists attachment_designation text;
