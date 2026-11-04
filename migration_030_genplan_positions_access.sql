-- ============================================================
-- Миграция 030 — права "генпланиста" на вкладку «Позиции по ГП».
--
-- Кто назначен исполнителем раздела с кодом ГП или ГТ (Проект → «Разделы и
-- исполнители»), может добавлять, менять и удалять позиции (public.positions)
-- наравне с ГИП и помощником ГИПа. Остальные права не меняются.
--
-- Выполнить в Supabase → SQL Editor
-- ============================================================

create or replace function public.is_genplan_user()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
    from public.disciplines d
    join public.discipline_assignees da on da.discipline_id = d.id
    join public.employees e on e.id = da.employee_id
    join public.profiles p on p.id = auth.uid()
    -- translate: латинская T в коде считается кириллической Т (на случай смешанной раскладки)
    where translate(upper(d.code), 'T', 'Т') in ('ГП', 'ГТ')
      and lower(e.email) = lower(p.email)
  );
$$;

drop policy if exists "positions_insert" on public.positions;
drop policy if exists "positions_update" on public.positions;
drop policy if exists "positions_delete" on public.positions;

create policy "positions_insert" on public.positions for insert
  with check (public.current_user_role() in ('gip','gip_assistant') or public.is_genplan_user());
create policy "positions_update" on public.positions for update
  using (public.current_user_role() in ('gip','gip_assistant') or public.is_genplan_user())
  with check (public.current_user_role() in ('gip','gip_assistant') or public.is_genplan_user());
create policy "positions_delete" on public.positions for delete
  using (public.current_user_role() in ('gip','gip_assistant') or public.is_genplan_user());
