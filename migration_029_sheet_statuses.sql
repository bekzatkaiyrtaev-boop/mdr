-- ============================================================
-- Миграция 029 — новый набор статусов листа (public.sheets.status):
--   not_started    — Не начат
--   received_hbec  — Получен от HBEC
--   returned_hbec  — Возвращен на доработку HBEC
--   sent_electronic — Электронная версия отправлена на площадку
--   sent_paper     — Бумажная версия направлена на площадку
--
-- Перенос старых значений:
--   not_started  → not_started
--   in_progress  → received_hbec     («В работе»)
--   construction → sent_electronic   («На стройплощадке»)
--   issued, approved → not_started   («На согласовании», «Согласован» — обнуляются)
--
-- Выполнить в Supabase → SQL Editor ПЕРЕД выкладкой новой версии сайта
-- ============================================================

alter table public.sheets drop constraint if exists sheets_status_check;

update public.sheets set status = case status
  when 'in_progress'  then 'received_hbec'
  when 'construction' then 'sent_electronic'
  when 'not_started'  then 'not_started'
  else 'not_started'
end;

alter table public.sheets add constraint sheets_status_check
  check (status in ('not_started','received_hbec','returned_hbec','sent_electronic','sent_paper'));
