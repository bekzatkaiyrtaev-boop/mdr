-- ============================================================
-- Миграция 024 — реквизиты проекта для титульного листа альбома.
--
-- Титульный лист (вкладка "Состав разделов" → кнопка "Титульный лист")
-- подставляет большинство полей из уже существующих данных (шифр, раздел,
-- объект, ГИП), но реквизиты организации (наименование, ГСЛ, директор,
-- город, стадия) в базе не хранились — заполняются один раз в "Проект".
--
-- Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

alter table public.projects
  add column if not exists company_name_ru text,
  add column if not exists company_name_en text,
  add column if not exists license_number text,
  add column if not exists director_name_ru text,
  add column if not exists director_name_en text,
  add column if not exists city_ru text,
  add column if not exists city_en text,
  add column if not exists stage_ru text,
  add column if not exists stage_en text;
