create extension if not exists pgcrypto;

create table if not exists public.app_admin_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_admin_settings enable row level security;

-- Change this password before sharing the admin page.
insert into public.app_admin_settings (key, value)
values (
  'admin_invite_secret_sha256',
  encode(digest('CHANGE_ME_ADMIN_PASSWORD', 'sha256'), 'hex')
)
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();

drop function if exists public.admin_create_invite(text, text, text, timestamptz, integer, text, text, text);

create or replace function public.admin_create_invite(
  input_admin_secret text,
  input_owner_name text,
  input_company text default null,
  input_expires_at timestamptz default null,
  input_max_uses integer default 1,
  input_custom_code text default null,
  input_label text default null,
  input_notes text default null
)
returns table (
  code text,
  owner_name text,
  company text,
  max_uses integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_hash text;
  candidate_code text;
  attempts integer := 0;
begin
  select value
    into expected_hash
    from app_admin_settings
   where key = 'admin_invite_secret_sha256';

  if expected_hash is null then
    raise exception 'Admin password is not configured';
  end if;

  if encode(digest(coalesce(input_admin_secret, ''), 'sha256'), 'hex') <> expected_hash then
    raise exception 'Admin password is incorrect';
  end if;

  if nullif(trim(input_owner_name), '') is null then
    raise exception 'Owner name is required';
  end if;

  if input_custom_code is not null and trim(input_custom_code) <> '' then
    candidate_code := upper(trim(input_custom_code));
  else
    loop
      attempts := attempts + 1;
      candidate_code := 'INV-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 12));
      exit when not exists (
        select 1 from invite_codes where invite_codes.code = candidate_code
      );
      if attempts > 10 then
        raise exception 'Failed to generate invite code';
      end if;
    end loop;
  end if;

  insert into invite_codes (
    code,
    label,
    owner_name,
    company,
    max_uses,
    expires_at,
    notes
  )
  values (
    candidate_code,
    coalesce(nullif(input_label, ''), trim(input_owner_name) || ' invite'),
    trim(input_owner_name),
    nullif(trim(input_company), ''),
    coalesce(input_max_uses, 1),
    input_expires_at,
    nullif(trim(input_notes), '')
  );

  return query
  select
    candidate_code,
    trim(input_owner_name),
    nullif(trim(input_company), ''),
    coalesce(input_max_uses, 1),
    input_expires_at;
end;
$$;

grant execute on function public.admin_create_invite(text, text, text, timestamptz, integer, text, text, text) to anon;
