-- ============================================================
-- Миграция 017 — "Отдельные тома": разделы (альбомы), не привязанные
-- ни к одной позиции по ГП, а прикреплённые прямо к тому (напр. том
-- "Инженерные изыскания" — сам не является позицией/зданием, но может
-- иметь свои разделы со своими листами).
--
-- position_disciplines.position_id становится необязательным, добавляется
-- volume_id — заполняется ровно один из двух (либо альбом в позиции,
-- либо альбом прямо в томе). sheets.position_id тоже становится
-- необязательным — у листов таких "отдельных" альбомов позиции нет.
-- Выполнить в Supabase → SQL Editor на уже созданном проекте
-- ============================================================

alter table public.position_disciplines alter column position_id drop not null;
alter table public.position_disciplines add column if not exists volume_id uuid references public.volumes(id) on delete cascade;

alter table public.position_disciplines drop constraint if exists position_disciplines_owner_check;
alter table public.position_disciplines add constraint position_disciplines_owner_check check (
  (position_id is not null and volume_id is null) or (position_id is null and volume_id is not null)
);

alter table public.sheets alter column position_id drop not null;
