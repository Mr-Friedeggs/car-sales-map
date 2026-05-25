create extension if not exists pgcrypto;

create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text,
  owner_name text,
  company text,
  enabled boolean not null default true,
  max_uses integer,
  used_count integer not null default 0,
  expires_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.invite_sessions (
  id uuid primary key default gen_random_uuid(),
  invite_code_id uuid not null references public.invite_codes(id) on delete cascade,
  visitor_name text,
  visitor_company text,
  first_page_url text,
  first_user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.visit_logs (
  id uuid primary key default gen_random_uuid(),
  invite_session_id uuid references public.invite_sessions(id) on delete set null,
  invite_code_id uuid references public.invite_codes(id) on delete set null,
  event_type text not null,
  page_url text,
  user_agent text,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.invite_codes enable row level security;
alter table public.invite_sessions enable row level security;
alter table public.visit_logs enable row level security;

create or replace function public.claim_invite(
  input_code text,
  visitor_name text default null,
  visitor_company text default null,
  page_url text default null,
  user_agent text default null
)
returns table (
  session_token uuid,
  invite_label text,
  owner_name text,
  company text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_row invite_codes%rowtype;
  new_session_id uuid;
begin
  select *
    into invite_row
    from invite_codes
   where lower(code) = lower(trim(input_code))
   limit 1;

  if invite_row.id is null then
    raise exception '邀请码不存在';
  end if;

  if invite_row.enabled is false then
    raise exception '邀请码已停用';
  end if;

  if invite_row.expires_at is not null and invite_row.expires_at < now() then
    raise exception '邀请码已过期';
  end if;

  if invite_row.max_uses is not null and invite_row.used_count >= invite_row.max_uses then
    raise exception '邀请码已达到使用次数上限';
  end if;

  insert into invite_sessions (
    invite_code_id,
    visitor_name,
    visitor_company,
    first_page_url,
    first_user_agent
  )
  values (
    invite_row.id,
    nullif(visitor_name, ''),
    nullif(visitor_company, ''),
    page_url,
    user_agent
  )
  returning id into new_session_id;

  update invite_codes
     set used_count = used_count + 1
   where id = invite_row.id;

  insert into visit_logs (
    invite_session_id,
    invite_code_id,
    event_type,
    page_url,
    user_agent,
    event_payload
  )
  values (
    new_session_id,
    invite_row.id,
    'invite_accepted',
    page_url,
    user_agent,
    jsonb_build_object(
      'visitor_name', visitor_name,
      'visitor_company', visitor_company
    )
  );

  return query
  select
    new_session_id,
    invite_row.label,
    coalesce(invite_row.owner_name, visitor_name),
    coalesce(invite_row.company, visitor_company);
end;
$$;

create or replace function public.log_visit_event(
  session_token uuid,
  event_type text,
  page_url text default null,
  user_agent text default null,
  event_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row invite_sessions%rowtype;
begin
  select *
    into session_row
    from invite_sessions
   where id = session_token
   limit 1;

  if session_row.id is null then
    raise exception '访问会话无效';
  end if;

  update invite_sessions
     set last_seen_at = now()
   where id = session_row.id;

  insert into visit_logs (
    invite_session_id,
    invite_code_id,
    event_type,
    page_url,
    user_agent,
    event_payload
  )
  values (
    session_row.id,
    session_row.invite_code_id,
    event_type,
    page_url,
    user_agent,
    coalesce(event_payload, '{}'::jsonb)
  );
end;
$$;

grant execute on function public.claim_invite(text, text, text, text, text) to anon;
grant execute on function public.log_visit_event(uuid, text, text, text, jsonb) to anon;

insert into public.invite_codes (code, label, owner_name, company, max_uses, expires_at, notes)
values ('DEMO2026', '演示邀请码', '演示用户', '内部测试', 50, now() + interval '30 days', '初始测试码')
on conflict (code) do nothing;
