-- ============================================================
-- МДР (Master Document Register) — схема БД для Supabase (Postgres)
-- Выполнить целиком в Supabase → SQL Editor на новом проекте.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- профили пользователей ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'engineer' check (role in ('gip','gip_assistant','engineer')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- при регистрации нового пользователя (auth.users) — автоматически создаём профиль;
-- если сотрудник уже заведён в employees (см. ниже) — имя и роль берутся оттуда
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first_user boolean;
  pre_role text;
  pre_name text;
begin
  select not exists(select 1 from public.profiles) into is_first_user;
  select role, full_name into pre_role, pre_name
    from public.employees where lower(email) = lower(new.email) limit 1;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id, new.email,
    coalesce(pre_name, new.raw_user_meta_data->>'full_name', new.email),
    coalesce(pre_role, case when is_first_user then 'gip' else 'engineer' end)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- хелперы для RLS-политик (security definer — обходят RLS profiles, чтобы не было рекурсии).
-- bekzat.kaiyrtaev@gmail.com — жёстко закреплённый администратор: всегда 'gip', независимо
-- от того, что записано в profiles.role (см. также protect_profile_privileges ниже)
create or replace function public.current_user_role()
returns text
language sql security definer stable
set search_path = public
as $$
  select case
    when (select email from auth.users u where u.id = auth.uid()) = 'bekzat.kaiyrtaev@gmail.com' then 'gip'
    else (select role from public.profiles where id = auth.uid())
  end;
$$;

-- есть ли у текущего пользователя доступ к разделу (по совпадению email с одним
-- из исполнителей раздела через employees — у раздела исполнителей может быть несколько,
-- см. discipline_assignees.employee_id)
create or replace function public.has_discipline_access(p_code text)
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
    where d.code = p_code
      and lower(e.email) = lower(p.email)
  );
$$;

-- защита от самоповышения роли — менять может только ГИП/помощник ГИПа;
-- у закреплённого администратора роль дополнительно принудительно всегда 'gip'
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('gip','gip_assistant') then
    new.role := old.role;
  end if;
  if (select email from auth.users where id = new.id) = 'bekzat.kaiyrtaev@gmail.com' then
    new.role := 'gip';
  end if;
  return new;
end;
$$;

create trigger trg_protect_profile_privileges
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

create policy "profiles_select" on public.profiles
  for select using (true);
create policy "profiles_update" on public.profiles
  for update using (id = auth.uid() or public.current_user_role() in ('gip','gip_assistant'));

-- ---------- справочник сотрудников (задаёт ГИП, вкладка "Пользователи") ----------
-- единый список сотрудников компании (Имя/Email/Роль) — не привязан к тому, зарегистрировался
-- ли человек уже в системе; исполнители разделов (discipline_assignees) ссылаются сюда по
-- employee_id. Роль здесь — то, что человек ПОЛУЧИТ при регистрации (см. handle_new_user);
-- если человек уже зарегистрирован — редактирование роли в UI обновляет и profiles.role
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  role text not null default 'engineer' check (role in ('gip','gip_assistant','engineer')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create unique index employees_email_unique on public.employees (lower(email));

alter table public.employees enable row level security;

create policy "employees_select" on public.employees for select using (true);
create policy "employees_insert" on public.employees for insert with check (public.current_user_role() in ('gip','gip_assistant'));
create policy "employees_update" on public.employees for update using (public.current_user_role() in ('gip','gip_assistant'));
create policy "employees_delete" on public.employees for delete using (public.current_user_role() in ('gip','gip_assistant'));

-- ---------- проект (шапка — задаёт ГИП) ----------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  contract_number text,
  name_ru text,
  name_en text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;

create policy "projects_select" on public.projects for select using (true);
create policy "projects_insert" on public.projects for insert with check (public.current_user_role() in ('gip','gip_assistant'));
create policy "projects_update" on public.projects for update using (public.current_user_role() in ('gip','gip_assistant'));

-- ---------- разделы и исполнители (задаёт ГИП, вкладка "Проект") ----------
create table public.disciplines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  volume_number text,          -- номер тома/книги/альбома, напр. "1", "1.1", "2" — по нему сортируются строки
  code text,                   -- краткий код раздела, напр. АС, КЖ — используется в обозначении листов
  name_ru text,                -- напр. "Архитектурные решения" — может быть заполнено позже
  name_en text,
  note text,                   -- примечание к разделу
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint disciplines_project_code_unique unique (project_id, code)
);

alter table public.disciplines enable row level security;

create policy "disciplines_select" on public.disciplines for select using (true);
create policy "disciplines_insert" on public.disciplines for insert with check (public.current_user_role() in ('gip','gip_assistant'));
create policy "disciplines_update" on public.disciplines for update using (public.current_user_role() in ('gip','gip_assistant'));
create policy "disciplines_delete" on public.disciplines for delete using (public.current_user_role() in ('gip','gip_assistant'));

-- ---------- исполнители раздела (у одного раздела их может быть несколько) ----------
-- сам исполнитель — ссылка на справочник сотрудников (public.employees), выбирается
-- по имени во вкладке "Проект"; доступ к разделу проверяется по email сотрудника —
-- работает даже если человек ещё не зарегистрировался в системе
create table public.discipline_assignees (
  id uuid primary key default gen_random_uuid(),
  discipline_id uuid not null references public.disciplines(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.discipline_assignees enable row level security;

create policy "discipline_assignees_select" on public.discipline_assignees for select using (true);
create policy "discipline_assignees_insert" on public.discipline_assignees for insert with check (public.current_user_role() in ('gip','gip_assistant'));
create policy "discipline_assignees_update" on public.discipline_assignees for update using (public.current_user_role() in ('gip','gip_assistant'));
create policy "discipline_assignees_delete" on public.discipline_assignees for delete using (public.current_user_role() in ('gip','gip_assistant'));

-- ---------- тома МДР (задаёт ГИП/помощник ГИПа прямо во вкладке MDR) ----------
create table public.volumes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  number text,        -- номер тома, напр. "1", "5" — отображается в колонке "Номер тома / номер альбома" в MDR
  name_ru text,
  name_en text,
  is_positions_root boolean not null default false, -- в этот том вкладываются позиции по генплану
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.volumes enable row level security;

create policy "volumes_select" on public.volumes for select using (true);
create policy "volumes_insert" on public.volumes for insert with check (public.current_user_role() in ('gip','gip_assistant'));
create policy "volumes_update" on public.volumes for update using (public.current_user_role() in ('gip','gip_assistant'));
create policy "volumes_delete" on public.volumes for delete using (public.current_user_role() in ('gip','gip_assistant'));

-- ---------- позиции (здания/сооружения — задаёт ГИП/помощник ГИПа) ----------
create table public.positions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id uuid references public.positions(id) on delete cascade,
  position_code text,   -- "Позиция по ГП"
  object_code text,     -- "Код объекта"
  name_ru text,          -- может быть заполнено позже
  name_en text,
  manual_number text,   -- "Номер тома / номер альбома" — ручное поле, ни на что не влияет
  sort_order int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.positions enable row level security;

create policy "positions_select" on public.positions for select using (true);
create policy "positions_insert" on public.positions for insert
  with check (public.current_user_role() in ('gip','gip_assistant'));
create policy "positions_update" on public.positions for update
  using (public.current_user_role() in ('gip','gip_assistant'));
create policy "positions_delete" on public.positions for delete
  using (public.current_user_role() in ('gip','gip_assistant'));

-- ---------- альбомы в позиции ИЛИ прямо в томе (задаёт ГИП/помощник ГИПа) ----------
-- один "раздел" (public.disciplines, напр. КЖ) может иметь несколько альбомов
-- в одной и той же позиции (напр. КЖ1 — фундаменты здания, КЖ2 — фундамент оборудования) —
-- это разные строки здесь, но ОДИН и тот же раздел/исполнитель в public.disciplines.
-- Заполняется ровно одно из двух: position_id (альбом в позиции — вкладка "Разделы в
-- позициях") или volume_id (альбом прямо в томе, без позиции — "Позиции по ГП" →
-- "Отдельные тома", напр. разделы внутри тома "Инженерные изыскания").
create table public.position_disciplines (
  id uuid primary key default gen_random_uuid(),
  position_id uuid references public.positions(id) on delete cascade,
  volume_id uuid references public.volumes(id) on delete cascade,
  discipline_code text not null,  -- базовый код раздела, напр. КЖ — общий для всех альбомов этого типа
  marker text,                    -- шифр именно этого альбома, напр. КЖ1, КЖ2.1 — можно редактировать вручную
  note text,                      -- примечание к этому конкретному альбому
  responsible text,               -- ответственный за этот конкретный альбом (свободный текст)
  manual_number text,             -- "Номер тома / номер альбома" — ручное поле, ни на что не влияет
  pinned boolean not null default false, -- закреплено: нельзя сдвинуть стрелками вверх/вниз (свою и соседних)
  sort_order int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint position_disciplines_owner_check check (
    (position_id is not null and volume_id is null) or (position_id is null and volume_id is not null)
  )
);

alter table public.position_disciplines enable row level security;

create policy "position_disciplines_select" on public.position_disciplines for select using (true);
create policy "position_disciplines_insert" on public.position_disciplines for insert
  with check (public.current_user_role() in ('gip','gip_assistant'));
create policy "position_disciplines_update" on public.position_disciplines for update
  using (public.current_user_role() in ('gip','gip_assistant'));
create policy "position_disciplines_delete" on public.position_disciplines for delete
  using (public.current_user_role() in ('gip','gip_assistant'));

-- ---------- документы (листы — добавляют инженеры в своём разделе) ----------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  position_id uuid not null references public.positions(id) on delete cascade,
  discipline_code text not null,   -- "Код департамента, специальности"
  doc_type text,                   -- "Тип документа" (GD, DW, RE...)
  doc_number text,                 -- "Нумерация"
  notation text,                   -- "Обозначение" (собирается на клиенте)
  name_ru text not null,
  name_en text,
  current_revision text not null default 'A',
  status text not null default 'not_started'
    check (status in ('not_started','in_progress','issued','approved','construction')),
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.documents enable row level security;

create policy "documents_select" on public.documents for select using (true);
create policy "documents_insert" on public.documents for insert
  with check (
    public.has_discipline_access(discipline_code)
    or public.current_user_role() in ('gip','gip_assistant')
  );
create policy "documents_update" on public.documents for update
  using (
    public.has_discipline_access(discipline_code)
    or public.current_user_role() in ('gip','gip_assistant')
    or created_by = auth.uid()
  );

-- ---------- хронология согласований по каждому документу ----------
create table public.revision_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  event_date date not null default current_date,
  event_type text not null, -- submitted / comments_received / resubmitted / approved / site_comments / other
  revision_letter text,
  source text,  -- кто/откуда: Заказчик, Технадзор, Авторский надзор, Стройплощадка...
  comment text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.revision_events enable row level security;

create policy "revision_events_select" on public.revision_events for select using (true);
create policy "revision_events_insert" on public.revision_events for insert
  with check (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and (
          public.has_discipline_access(d.discipline_code)
          or public.current_user_role() in ('gip','gip_assistant')
        )
    )
  );

-- ---------- состав разделов (листы внутри альбома — заполняют инженеры) ----------
create table public.sheets (
  id uuid primary key default gen_random_uuid(),
  position_id uuid references public.positions(id) on delete cascade, -- пусто у листов альбома, привязанного прямо к тому (см. "Отдельные тома")
  discipline_code text not null,
  name_ru text,          -- наименование листа
  name_en text,          -- перевод наименования (можно сгенерировать автопереводом и поправить вручную)
  format text,           -- формат листа (А4, А3, А1...)
  revision text,         -- "Ревизия" — задаётся только здесь, во вкладке "Состав разделов";
                          -- в MDR ("Ревизия") просто отображается, не редактируется там
  edition text,           -- "Редакция" — задаётся прямо в MDR (обычно R01/R02/A1/A2/A3)
  designation text,       -- обозначение листа
  comment text,           -- комментарии к листу
  reply text,             -- ответы на комментарии
  checked_by_name text,   -- ФИО проверившего лист
  manual_number text,     -- "Номер тома / номер альбома" — ручное поле, ни на что не влияет
  status text not null default 'not_started'
    check (status in ('not_started','in_progress','issued','approved','construction')),
  sort_order int not null default 0,
  position_discipline_id uuid references public.position_disciplines(id) on delete cascade, -- к какому именно альбому относится лист
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sheets enable row level security;

create policy "sheets_select" on public.sheets for select using (true);
create policy "sheets_insert" on public.sheets for insert
  with check (
    exists (
      select 1 from public.position_disciplines pd
      where pd.id = position_discipline_id
        and (public.has_discipline_access(pd.discipline_code) or public.current_user_role() in ('gip','gip_assistant'))
    )
  );
create policy "sheets_update" on public.sheets for update
  using (
    exists (
      select 1 from public.position_disciplines pd
      where pd.id = position_discipline_id
        and (public.has_discipline_access(pd.discipline_code) or public.current_user_role() in ('gip','gip_assistant'))
    )
  );
create policy "sheets_delete" on public.sheets for delete
  using (
    exists (
      select 1 from public.position_disciplines pd
      where pd.id = position_discipline_id
        and (public.has_discipline_access(pd.discipline_code) or public.current_user_role() in ('gip','gip_assistant'))
    )
  );

-- ---------- поручения (вкладка "Поручения" — задаёт ГИП/помощник ГИПа) ----------
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  text text,                    -- "Поручение"
  basis text,                   -- "Основание"
  author_id uuid references public.employees(id) on delete set null,
  assignee_id uuid references public.employees(id) on delete set null,
  issued_date date,             -- "Дата выдачи"
  deadline date,                -- "Дедлайн"
  status text not null default 'not_started' check (status in ('not_started','in_progress','done','cancelled')),
  note text,                    -- "Примечание"
  sort_order int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.assignments enable row level security;

create policy "assignments_select" on public.assignments for select using (true);
create policy "assignments_insert" on public.assignments for insert with check (public.current_user_role() in ('gip','gip_assistant'));
create policy "assignments_update" on public.assignments for update using (public.current_user_role() in ('gip','gip_assistant'));
create policy "assignments_delete" on public.assignments for delete using (public.current_user_role() in ('gip','gip_assistant'));
