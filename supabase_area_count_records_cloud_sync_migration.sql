-- Cloud sync migration (run 2/4).
-- Prerequisite: supabase_area_count_records_cloud_sync_backup.sql completed successfully.
-- This is a one-shot, transactional migration. Do not run it while legacy clients are
-- still writing with on_conflict=date,session_started_at,area_id,discount_time.

begin;

do $$
begin
  if to_regclass('public.area_count_records') is null then
    raise exception 'public.area_count_records does not exist';
  end if;
  if to_regclass('public.area_count_records_backup_20260809_cloud_sync') is null then
    raise exception 'cloud sync backup is missing; run the backup SQL first';
  end if;
  if to_regclass('public.review19_records') is not null then
    raise exception 'public.review19_records already exists; inspect the prior attempt and its backup';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'area_count_records'
      and column_name in ('demand_cycle', 'record_details')
  ) then
    raise exception 'cloud sync columns already exist; migration is intentionally not rerunnable';
  end if;
end;
$$;

lock table public.area_count_records in access exclusive mode;

-- Reject a stale backup even when its row count happens to match.
do $$
begin
  if exists (
    (
      select id, data_schema_version, app_version, build_id, date,
        session_started_at, recorded_at, area_id, discount_time,
        actual_weekday, actual_weekday_group, count, created_at, updated_at
      from public.area_count_records
      except all
      select id, data_schema_version, app_version, build_id, date,
        session_started_at, recorded_at, area_id, discount_time,
        actual_weekday, actual_weekday_group, count, created_at, updated_at
      from public.area_count_records_backup_20260809_cloud_sync
    )
    union all
    (
      select id, data_schema_version, app_version, build_id, date,
        session_started_at, recorded_at, area_id, discount_time,
        actual_weekday, actual_weekday_group, count, created_at, updated_at
      from public.area_count_records_backup_20260809_cloud_sync
      except all
      select id, data_schema_version, app_version, build_id, date,
        session_started_at, recorded_at, area_id, discount_time,
        actual_weekday, actual_weekday_group, count, created_at, updated_at
      from public.area_count_records
    )
  ) then
    raise exception 'area_count_records changed after backup; create a fresh backup';
  end if;
end;
$$;

alter table public.area_count_records
  add column demand_cycle text not null default 'normal',
  add column record_details jsonb not null default '{}'::jsonb,
  add constraint area_count_records_demand_cycle_check
    check (demand_cycle in ('normal', 'summer')),
  add constraint area_count_records_record_details_object_check
    check (jsonb_typeof(record_details) = 'object');

-- Add the new arbiter before removing the legacy arbiter. The transaction never has
-- a moment without a uniqueness guarantee.
alter table public.area_count_records
  add constraint area_count_records_cloud_sync_key
  unique (date, session_started_at, area_id, discount_time, demand_cycle);

-- The legacy constraint was unnamed in the original CREATE TABLE and PostgreSQL may
-- truncate its generated name. Locate it by ordered constrained columns, not by name.
do $$
declare
  legacy_constraint_names text[];
begin
  select array_agg(constraint_row.conname::text order by constraint_row.conname)
  into legacy_constraint_names
  from (
    select constraint_entry.conname
    from pg_constraint as constraint_entry
    where constraint_entry.conrelid = 'public.area_count_records'::regclass
      and constraint_entry.contype = 'u'
      and array(
        select attribute_entry.attname::text
        from unnest(constraint_entry.conkey) with ordinality
          as key_entry(attnum, ordinal_position)
        join pg_attribute as attribute_entry
          on attribute_entry.attrelid = constraint_entry.conrelid
         and attribute_entry.attnum = key_entry.attnum
        order by key_entry.ordinal_position
      ) = array[
        'date', 'session_started_at', 'area_id', 'discount_time'
      ]::text[]
  ) as constraint_row;

  if coalesce(cardinality(legacy_constraint_names), 0) <> 1 then
    raise exception 'expected exactly one legacy four-column unique constraint, found %',
      coalesce(cardinality(legacy_constraint_names), 0);
  end if;

  execute format(
    'alter table public.area_count_records drop constraint %I',
    legacy_constraint_names[1]
  );
end;
$$;

create index area_count_records_cycle_lookup_idx
  on public.area_count_records
  (demand_cycle, area_id, discount_time, actual_weekday, recorded_at desc);

create index area_count_records_cycle_group_lookup_idx
  on public.area_count_records
  (demand_cycle, area_id, discount_time, actual_weekday_group, recorded_at desc);

create or replace function public.guard_area_count_records_cloud_sync_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  incoming_record_details jsonb;
  incoming_human_evaluation jsonb;
  existing_human_evaluation jsonb;
begin
  -- A delayed/offline upsert must not replace a newer observation.
  if new.recorded_at < old.recorded_at then
    return null;
  end if;

  -- The same observation may be backfilled by another client. Preserve every fixed
  -- column from the existing row and only add JSON keys it does not already have.
  -- NEW || OLD deliberately gives the existing (OLD) value precedence on key clashes.
  if new.recorded_at = old.recorded_at then
    incoming_record_details := coalesce(new.record_details, '{}'::jsonb);
    incoming_human_evaluation :=
      incoming_record_details -> 'humanEvaluationDetails';
    existing_human_evaluation :=
      old.record_details -> 'humanEvaluationDetails';
    new := old;
    new.record_details := incoming_record_details
      || coalesce(old.record_details, '{}'::jsonb);

    -- humanEvaluationDetails is the one rich field where mere top-level presence is
    -- insufficient: a generated legacy scale-5 envelope must not hide a scale-9
    -- observation. Scale 9 wins in either direction; equal scales keep OLD so arrival
    -- order cannot make an existing remote row oscillate.
    if jsonb_typeof(incoming_human_evaluation) = 'object'
      and incoming_human_evaluation ->> 'humanEvaluationScale' = '9'
      and not (
        jsonb_typeof(existing_human_evaluation) = 'object'
        and existing_human_evaluation ->> 'humanEvaluationScale' = '9'
      )
    then
      new.record_details := jsonb_set(
        new.record_details,
        '{humanEvaluationDetails}',
        incoming_human_evaluation,
        true
      );
    end if;

    return new;
  end if;

  -- A strictly newer revision wins JSON key clashes while retaining omitted old keys.
  if new.record_details is null or new.record_details = '{}'::jsonb then
    new.record_details := old.record_details;
  else
    new.record_details := coalesce(old.record_details, '{}'::jsonb)
      || new.record_details;
  end if;

  return new;
end;
$$;

create trigger guard_area_count_records_cloud_sync_update
before update on public.area_count_records
for each row
execute function public.guard_area_count_records_cloud_sync_update();

create table public.review19_records (
  id bigint generated by default as identity primary key,
  data_schema_version integer
    constraint review19_records_data_schema_version_check
    check (data_schema_version >= 1),
  app_version text,
  build_id text,
  date text not null
    constraint review19_records_date_format_check
    check (
      date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and to_char(date::date, 'YYYY-MM-DD') = date
    ),
  session_started_at text not null
    constraint review19_records_session_started_at_check
    check (
      btrim(session_started_at) <> ''
      and session_started_at::timestamptz is not null
    ),
  demand_cycle text not null default 'normal'
    constraint review19_records_demand_cycle_check
    check (demand_cycle in ('normal', 'summer')),
  recorded_at timestamptz,
  source_updated_at timestamptz not null,
  is_complete boolean not null default false,
  payload jsonb not null default '{}'::jsonb
    constraint review19_records_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review19_records_source_timestamp_check
    check (
      source_updated_at >= session_started_at::timestamptz
      and (recorded_at is null or source_updated_at >= recorded_at)
    ),
  constraint review19_records_payload_identity_check
    check (
      coalesce(jsonb_typeof(payload -> 'date') = 'string', false)
      and payload ->> 'date' = date
      and coalesce(
        jsonb_typeof(payload -> 'sessionStartedAt') = 'string',
        false
      )
      and payload ->> 'sessionStartedAt' = session_started_at
      and coalesce(payload ->> 'demandCycle', 'normal') = demand_cycle
      and coalesce(
        jsonb_typeof(payload -> 'sourceUpdatedAt') = 'string',
        false
      )
      and (payload ->> 'sourceUpdatedAt')::timestamptz = source_updated_at
      and coalesce(
        jsonb_typeof(payload #> '{dataQuality,complete}') = 'boolean',
        false
      )
      and payload #>> '{dataQuality,complete}' = is_complete::text
      and (
        (
          recorded_at is null
          and coalesce(payload ->> 'recordedAt', '') = ''
        )
        or (
          recorded_at is not null
          and coalesce(
            jsonb_typeof(payload -> 'recordedAt') = 'string',
            false
          )
          and (payload ->> 'recordedAt')::timestamptz = recorded_at
        )
      )
    ),
  constraint review19_records_date_demand_cycle_key
    unique (date, demand_cycle)
);

create index review19_records_cycle_recorded_at_idx
  on public.review19_records (demand_cycle, recorded_at desc);

create or replace function public.guard_review19_records_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- recorded_at, not is_complete, is the final marker. A final row can never
  -- regress to a partial row, even if that partial arrives later.
  if old.recorded_at is not null and new.recorded_at is null then
    return null;
  end if;

  -- source_updated_at orders every same-key mutation. A partial-to-final write at
  -- the same source timestamp is the sole safe equal-time promotion; every other
  -- equal-time write keeps the existing remote row deterministically.
  if new.source_updated_at < old.source_updated_at then
    return null;
  end if;

  if new.source_updated_at = old.source_updated_at
    and not (
      old.recorded_at is null
      and new.recorded_at is not null
    )
  then
    return null;
  end if;

  return new;
end;
$$;

create trigger guard_review19_records_update
before update on public.review19_records
for each row
execute function public.guard_review19_records_update();

create or replace function public.set_review19_records_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_review19_records_updated_at
before update on public.review19_records
for each row
execute function public.set_review19_records_updated_at();

alter table public.review19_records enable row level security;

create policy "review19_records_select"
on public.review19_records
for select
to anon
using (true);

create policy "review19_records_insert"
on public.review19_records
for insert
to anon
with check (true);

create policy "review19_records_update"
on public.review19_records
for update
to anon
using (true)
with check (true);

-- Policies do not grant SQL privileges. Make the intended anonymous access explicit.
revoke all on table public.review19_records from public, anon, authenticated;
grant select, insert, update on table public.review19_records to anon;
revoke all on sequence public.review19_records_id_seq
  from public, anon, authenticated;
grant usage, select on sequence public.review19_records_id_seq to anon;

-- Trigger functions need not remain directly executable by API roles after the
-- triggers have been created.
revoke execute on function public.guard_area_count_records_cloud_sync_update()
  from public, anon, authenticated;
revoke execute on function public.guard_review19_records_update()
  from public, anon, authenticated;
revoke execute on function public.set_review19_records_updated_at()
  from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
