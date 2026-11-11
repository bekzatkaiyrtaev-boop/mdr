-- ============================================================
-- Миграция 040 — вкладка «Материалы»: раздача программы «Печать по слоям»
-- только сотрудникам из списка «Пользователи» + выдача ключей активации.
--
-- 1) can_use_materials() — ЕДИНОЕ правило «кому можно»: ГИП/помощник ГИПа или
--    сотрудник из public.employees (по email), у которого роль не «Наблюдатель».
--    Его же использует Edge Function issue-activation — правило нигде не дублируется.
-- 2) materials — описание и файл программы (описание правят ГИП/помощник ГИПа).
-- 3) приватный бакет Storage «materials» — скачать файл можно только по подписанной
--    ссылке, а выдать её политика позволяет только тем, кто проходит can_use_materials().
-- 4) app_activations — журнал выданных ключей (кому, на какой компьютер, когда).
--    Писать сюда может только Edge Function (service role), пользователи — только читают своё.
--
-- Выполнить в Supabase → SQL Editor, затем задеплоить Edge Function
-- (см. activation-client/README.md).
-- ============================================================

-- ---------- 1. единое правило доступа ----------
create or replace function public.can_use_materials()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('gip','gip_assistant'), false)
      or exists (
        select 1 from public.employees e
        where lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
          and e.role <> 'viewer'
      );
$$;

-- ---------- 2. материалы ----------
create table if not exists public.materials (
  key         text primary key,            -- 'layerprint'
  title       text not null,
  description text,
  version     text,
  file_path   text,                        -- путь в бакете materials, напр. layerprint/LayerPrint-1.3.zip
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now()
);

alter table public.materials enable row level security;

drop policy if exists "materials_select" on public.materials;
create policy "materials_select" on public.materials for select
  using (public.can_use_materials());

drop policy if exists "materials_update" on public.materials;
create policy "materials_update" on public.materials for update
  using (public.current_user_role() in ('gip','gip_assistant'))
  with check (public.current_user_role() in ('gip','gip_assistant'));

insert into public.materials (key, title, description, version, file_path)
values (
  'layerprint',
  'Печать по слоям',
  $desc$Отдельная программа для печати чертежей AutoCAD без СПДС: PDF и печать на принтеры по слоям.

• Находит листы по слою с границами и слою с номерами листов, проверяет рамки и подписи.
• Имя листа формируется автоматически: Шифр альбома + «-» + Ревизия + «_Л» + Номер листа.
• Экспорт в PDF одной книгой или отдельными файлами, печать на устройства по форматам.
• Размер страницы берётся из рамки, геометрия печатается 1:1, нестандартные форматы поддерживаются.

Требуется AutoCAD 2022 для Windows x64 (не AutoCAD LT). Установка не нужна — программа запускается из папки. При первом запуске потребуется активация: ключ выдаётся ниже, на этой странице.$desc$,
  '1.3',
  null
)
on conflict (key) do nothing;

-- ---------- 3. приватное хранилище файлов ----------
insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict (id) do nothing;

drop policy if exists "materials_files_select" on storage.objects;
create policy "materials_files_select" on storage.objects for select
  using (bucket_id = 'materials' and public.can_use_materials());

drop policy if exists "materials_files_insert" on storage.objects;
create policy "materials_files_insert" on storage.objects for insert
  with check (bucket_id = 'materials' and public.current_user_role() in ('gip','gip_assistant'));

drop policy if exists "materials_files_update" on storage.objects;
create policy "materials_files_update" on storage.objects for update
  using (bucket_id = 'materials' and public.current_user_role() in ('gip','gip_assistant'));

drop policy if exists "materials_files_delete" on storage.objects;
create policy "materials_files_delete" on storage.objects for delete
  using (bucket_id = 'materials' and public.current_user_role() in ('gip','gip_assistant'));

-- ---------- 4. журнал активаций ----------
create table if not exists public.app_activations (
  id             uuid primary key default gen_random_uuid(),
  material_key   text not null references public.materials(key) on delete cascade,
  user_email     text not null,            -- всегда в нижнем регистре
  machine_id     text not null,            -- «код компьютера» из программы, XXXX-XXXX-XXXX-XXXX
  activation_key text not null,
  created_at     timestamptz not null default now()
);

-- один и тот же компьютер того же пользователя получает тот же ключ (повторный запрос идемпотентен)
create unique index if not exists app_activations_unique
  on public.app_activations (material_key, lower(user_email), machine_id);

alter table public.app_activations enable row level security;

drop policy if exists "app_activations_select" on public.app_activations;
create policy "app_activations_select" on public.app_activations for select
  using (
    lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or public.current_user_role() in ('gip','gip_assistant')
  );

-- удалить запись (освободить «слот» компьютера сотрудника) может ГИП/помощник ГИПа;
-- вставки/правки нет ни у кого из пользователей — только у Edge Function через service role
drop policy if exists "app_activations_delete" on public.app_activations;
create policy "app_activations_delete" on public.app_activations for delete
  using (public.current_user_role() in ('gip','gip_assistant'));
