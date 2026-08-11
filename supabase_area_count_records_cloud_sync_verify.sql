-- Cloud sync verification (run 3/4).
-- Read-only catalog/data checks. Any mismatch raises an exception.

do $$
declare
  matching_constraint_count integer;
begin
  if to_regclass('public.area_count_records_backup_20260809_cloud_sync') is null then
    raise exception 'cloud sync backup is missing';
  end if;
  if to_regclass('public.area_count_records') is null then
    raise exception 'public.area_count_records is missing';
  end if;
  if to_regclass('public.review19_records') is null then
    raise exception 'public.review19_records is missing';
  end if;

  -- Exact area_count_records column contract.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'area_count_records'
      and column_name not in (
        'id', 'data_schema_version', 'app_version', 'build_id', 'date',
        'session_started_at', 'recorded_at', 'area_id', 'discount_time',
        'actual_weekday', 'actual_weekday_group', 'count', 'created_at',
        'updated_at', 'demand_cycle', 'record_details'
      )
  ) then
    raise exception 'unexpected columns exist in public.area_count_records';
  end if;

  if exists (
    select expected.column_name
    from (values
      ('id'), ('data_schema_version'), ('app_version'), ('build_id'), ('date'),
      ('session_started_at'), ('recorded_at'), ('area_id'), ('discount_time'),
      ('actual_weekday'), ('actual_weekday_group'), ('count'), ('created_at'),
      ('updated_at'), ('demand_cycle'), ('record_details')
    ) as expected(column_name)
    except
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'area_count_records'
  ) then
    raise exception 'required area_count_records columns are missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'area_count_records'
      and column_name = 'demand_cycle' and data_type = 'text'
      and is_nullable = 'NO' and column_default like '%normal%'
  ) then
    raise exception 'area_count_records.demand_cycle type/nullability/default is wrong';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'area_count_records'
      and column_name = 'record_details' and data_type = 'jsonb'
      and is_nullable = 'NO' and column_default like '%{}%'
  ) then
    raise exception 'area_count_records.record_details type/nullability/default is wrong';
  end if;

  -- Every pre-migration row must be preserved byte-for-value in retained columns.
  if exists (
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
    union all
    (
      select id, data_schema_version, app_version, build_id, date,
        session_started_at, recorded_at, area_id, discount_time,
        actual_weekday, actual_weekday_group, count, created_at, updated_at
      from public.area_count_records
      where id in (
        select id from public.area_count_records_backup_20260809_cloud_sync
      )
      except all
      select id, data_schema_version, app_version, build_id, date,
        session_started_at, recorded_at, area_id, discount_time,
        actual_weekday, actual_weekday_group, count, created_at, updated_at
      from public.area_count_records_backup_20260809_cloud_sync
    )
  ) then
    raise exception 'retained area_count_records data differs from backup';
  end if;

  if exists (
    select 1
    from public.area_count_records as current_record
    join public.area_count_records_backup_20260809_cloud_sync as backup_record
      on backup_record.id = current_record.id
    where current_record.demand_cycle <> 'normal'
       or current_record.record_details <> '{}'::jsonb
  ) then
    raise exception 'legacy rows were not backfilled as normal with empty details';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.area_count_records'::regclass
      and conname = 'area_count_records_demand_cycle_check'
      and contype = 'c' and convalidated
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.area_count_records'::regclass
      and conname = 'area_count_records_record_details_object_check'
      and contype = 'c' and convalidated
  ) then
    raise exception 'area_count_records cloud sync checks are missing or unvalidated';
  end if;

  select count(*) into matching_constraint_count
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
      'date', 'session_started_at', 'area_id', 'discount_time', 'demand_cycle'
    ]::text[];
  if matching_constraint_count <> 1 then
    raise exception 'expected one five-column area_count_records unique key, found %',
      matching_constraint_count;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.area_count_records'::regclass
      and conname = 'area_count_records_cloud_sync_key'
      and contype = 'u' and convalidated
  ) then
    raise exception 'named area_count_records cloud sync unique constraint is missing';
  end if;

  select count(*) into matching_constraint_count
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
    ]::text[];
  if matching_constraint_count <> 0 then
    raise exception 'legacy four-column unique key still exists';
  end if;

  if exists (
    select 1 from public.area_count_records
    group by date, session_started_at, area_id, discount_time, demand_cycle
    having count(*) > 1
  ) then
    raise exception 'duplicate five-column area_count_records keys exist';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'area_count_records'
      and indexname = 'area_count_records_cycle_lookup_idx'
      and indexdef like '%(demand_cycle, area_id, discount_time, actual_weekday, recorded_at DESC)%'
  ) or not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'area_count_records'
      and indexname = 'area_count_records_cycle_group_lookup_idx'
      and indexdef like '%(demand_cycle, area_id, discount_time, actual_weekday_group, recorded_at DESC)%'
  ) then
    raise exception 'cycle-aware area_count_records indexes are missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.area_count_records'::regclass
      and tgname = 'guard_area_count_records_cloud_sync_update'
      and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'area_count_records cloud sync update guard is missing';
  end if;

  if not exists (
    select 1
    from pg_proc as function_entry
    join pg_namespace as namespace_entry
      on namespace_entry.oid = function_entry.pronamespace
    where namespace_entry.nspname = 'public'
      and function_entry.proname = 'guard_area_count_records_cloud_sync_update'
      and lower(pg_get_functiondef(function_entry.oid))
        like '%new.recorded_at < old.recorded_at%'
      and lower(pg_get_functiondef(function_entry.oid))
        like '%new.recorded_at = old.recorded_at%'
      and lower(pg_get_functiondef(function_entry.oid))
        like '%new := old%'
      and lower(pg_get_functiondef(function_entry.oid))
        like '%incoming_record_details%|| coalesce(old.record_details%'
      and lower(pg_get_functiondef(function_entry.oid))
        like '%incoming_human_evaluation ->> ''humanevaluationscale'' = ''9''%'
      and lower(pg_get_functiondef(function_entry.oid))
        like '%existing_human_evaluation ->> ''humanevaluationscale'' = ''9''%'
      and lower(pg_get_functiondef(function_entry.oid))
        like '%jsonb_set(%{humanevaluationdetails}%incoming_human_evaluation%'
      and lower(pg_get_functiondef(function_entry.oid))
        like '%coalesce(old.record_details, ''{}''::jsonb)%|| new.record_details%'
  ) then
    raise exception 'area_count_records stale/equal/newer precedence guard is wrong';
  end if;

  -- Exact review19_records column contract and defaults.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'review19_records'
      and column_name not in (
        'id', 'data_schema_version', 'app_version', 'build_id', 'date',
        'session_started_at', 'demand_cycle', 'recorded_at', 'is_complete',
        'source_updated_at', 'payload', 'created_at', 'updated_at'
      )
  ) then
    raise exception 'unexpected columns exist in public.review19_records';
  end if;

  if exists (
    select expected.column_name
    from (values
      ('id'), ('data_schema_version'), ('app_version'), ('build_id'), ('date'),
      ('session_started_at'), ('demand_cycle'), ('recorded_at'), ('is_complete'),
      ('source_updated_at'), ('payload'), ('created_at'), ('updated_at')
    ) as expected(column_name)
    except
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'review19_records'
  ) then
    raise exception 'required review19_records columns are missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'review19_records'
      and column_name = 'recorded_at' and data_type = 'timestamp with time zone'
      and is_nullable = 'YES'
  ) then
    raise exception 'review19_records.recorded_at must be nullable timestamptz';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'review19_records'
      and column_name = 'source_updated_at'
      and data_type = 'timestamp with time zone' and is_nullable = 'NO'
  ) then
    raise exception 'review19_records.source_updated_at must be non-null timestamptz';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'review19_records'
      and column_name = 'demand_cycle' and data_type = 'text'
      and is_nullable = 'NO' and column_default like '%normal%'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'review19_records'
      and column_name = 'payload' and data_type = 'jsonb'
      and is_nullable = 'NO' and column_default like '%{}%'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'review19_records'
      and column_name = 'is_complete' and data_type = 'boolean'
      and is_nullable = 'NO' and column_default = 'false'
  ) then
    raise exception 'review19_records defaults or nullability are wrong';
  end if;

  if (
    select count(*) from pg_constraint
    where conrelid = 'public.review19_records'::regclass
      and convalidated
      and conname in (
        'review19_records_data_schema_version_check',
        'review19_records_date_format_check',
        'review19_records_session_started_at_check',
        'review19_records_demand_cycle_check',
        'review19_records_payload_object_check',
        'review19_records_source_timestamp_check',
        'review19_records_payload_identity_check',
        'review19_records_date_demand_cycle_key'
      )
  ) <> 8 then
    raise exception 'review19_records constraints are missing or unvalidated';
  end if;

  if not exists (
    select 1
    from pg_constraint as constraint_entry
    where constraint_entry.conrelid = 'public.review19_records'::regclass
      and constraint_entry.conname = 'review19_records_payload_identity_check'
      and lower(pg_get_constraintdef(constraint_entry.oid))
        like '%sourceupdatedat%source_updated_at%'
      and lower(pg_get_constraintdef(constraint_entry.oid))
        like '%dataquality%complete%is_complete%'
  ) then
    raise exception 'review19_records payload/row identity constraint is wrong';
  end if;

  select count(*) into matching_constraint_count
  from pg_constraint as constraint_entry
  where constraint_entry.conrelid = 'public.review19_records'::regclass
    and constraint_entry.contype = 'u'
    and array(
      select attribute_entry.attname::text
      from unnest(constraint_entry.conkey) with ordinality
        as key_entry(attnum, ordinal_position)
      join pg_attribute as attribute_entry
        on attribute_entry.attrelid = constraint_entry.conrelid
       and attribute_entry.attnum = key_entry.attnum
      order by key_entry.ordinal_position
    ) = array['date', 'demand_cycle']::text[];
  if matching_constraint_count <> 1 then
    raise exception 'review19_records date/cycle unique key is wrong';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.review19_records'::regclass
      and conname = 'review19_records_date_demand_cycle_key'
      and contype = 'u' and convalidated
  ) then
    raise exception 'named review19_records unique constraint is missing';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'review19_records'
      and indexname = 'review19_records_cycle_recorded_at_idx'
      and indexdef like '%(demand_cycle, recorded_at DESC)%'
  ) then
    raise exception 'review19_records cycle/recorded_at index is missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.review19_records'::regclass
      and tgname = 'guard_review19_records_update'
      and not tgisinternal and tgenabled <> 'D'
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.review19_records'::regclass
      and tgname = 'set_review19_records_updated_at'
      and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'review19_records triggers are missing';
  end if;

  if not exists (
    select 1
    from pg_proc as function_entry
    join pg_namespace as namespace_entry
      on namespace_entry.oid = function_entry.pronamespace
    cross join lateral (
      select regexp_replace(
        lower(pg_get_functiondef(function_entry.oid)),
        '[[:space:]]+',
        ' ',
        'g'
      ) as normalized_definition
    ) as function_definition
    where namespace_entry.nspname = 'public'
      and function_entry.proname = 'guard_review19_records_update'
      and function_definition.normalized_definition
        like '%old.recorded_at is not null and new.recorded_at is null%'
      and function_definition.normalized_definition
        like '%new.source_updated_at < old.source_updated_at%'
      and function_definition.normalized_definition
        like '%new.source_updated_at = old.source_updated_at%'
      and function_definition.normalized_definition
        like '%old.recorded_at is null and new.recorded_at is not null%'
  ) then
    raise exception 'review19_records final/freshness guard definition is wrong';
  end if;

  if not exists (
    select 1 from pg_class as table_entry
    join pg_namespace as namespace_entry on namespace_entry.oid = table_entry.relnamespace
    where namespace_entry.nspname = 'public'
      and table_entry.relname = 'area_count_records' and table_entry.relrowsecurity
  ) or not exists (
    select 1 from pg_class as table_entry
    join pg_namespace as namespace_entry on namespace_entry.oid = table_entry.relnamespace
    where namespace_entry.nspname = 'public'
      and table_entry.relname = 'review19_records' and table_entry.relrowsecurity
  ) then
    raise exception 'RLS is not enabled on both live tables';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'area_count_records'
      and policyname = 'area_count_records_select' and cmd = 'SELECT'
      and 'anon' = any(roles)
      and btrim(coalesce(qual, ''), '() ') = 'true'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'area_count_records'
      and policyname = 'area_count_records_insert' and cmd = 'INSERT'
      and 'anon' = any(roles)
      and btrim(coalesce(with_check, ''), '() ') = 'true'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'area_count_records'
      and policyname = 'area_count_records_update' and cmd = 'UPDATE'
      and 'anon' = any(roles)
      and btrim(coalesce(qual, ''), '() ') = 'true'
      and btrim(coalesce(with_check, ''), '() ') = 'true'
  ) or exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'area_count_records'
      and cmd in ('DELETE', 'ALL')
  ) or (
    select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'area_count_records'
  ) <> 3 then
    raise exception 'area_count_records RLS policies are wrong';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'review19_records'
      and policyname = 'review19_records_select' and cmd = 'SELECT'
      and 'anon' = any(roles)
      and btrim(coalesce(qual, ''), '() ') = 'true'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'review19_records'
      and policyname = 'review19_records_insert' and cmd = 'INSERT'
      and 'anon' = any(roles)
      and btrim(coalesce(with_check, ''), '() ') = 'true'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'review19_records'
      and policyname = 'review19_records_update' and cmd = 'UPDATE'
      and 'anon' = any(roles)
      and btrim(coalesce(qual, ''), '() ') = 'true'
      and btrim(coalesce(with_check, ''), '() ') = 'true'
  ) or exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'review19_records'
      and cmd in ('DELETE', 'ALL')
  ) or (
    select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'review19_records'
  ) <> 3 then
    raise exception 'review19_records RLS policies are wrong';
  end if;

  if not has_table_privilege('anon', 'public.review19_records', 'SELECT')
    or not has_table_privilege('anon', 'public.review19_records', 'INSERT')
    or not has_table_privilege('anon', 'public.review19_records', 'UPDATE')
    or has_table_privilege('anon', 'public.review19_records', 'DELETE')
    or has_table_privilege('anon', 'public.review19_records', 'TRUNCATE')
    or has_table_privilege('anon', 'public.review19_records', 'REFERENCES')
    or has_table_privilege('anon', 'public.review19_records', 'TRIGGER')
  then
    raise exception 'anon table grants for review19_records are not least-privilege';
  end if;

  if has_table_privilege('authenticated', 'public.review19_records', 'SELECT')
    or has_table_privilege('authenticated', 'public.review19_records', 'INSERT')
    or has_table_privilege('authenticated', 'public.review19_records', 'UPDATE')
    or has_table_privilege('authenticated', 'public.review19_records', 'DELETE')
    or has_table_privilege('authenticated', 'public.review19_records', 'TRUNCATE')
    or has_table_privilege('authenticated', 'public.review19_records', 'REFERENCES')
    or has_table_privilege('authenticated', 'public.review19_records', 'TRIGGER')
  then
    raise exception 'authenticated unexpectedly has review19_records privileges';
  end if;

  if not has_sequence_privilege(
    'anon', 'public.review19_records_id_seq', 'USAGE'
  ) then
    raise exception 'anon identity-sequence grant for review19_records is missing';
  end if;

  if has_sequence_privilege(
    'authenticated', 'public.review19_records_id_seq', 'USAGE'
  ) then
    raise exception 'authenticated unexpectedly has review19 sequence usage';
  end if;

  if has_function_privilege(
    'anon', 'public.guard_area_count_records_cloud_sync_update()', 'EXECUTE'
  ) or has_function_privilege(
    'anon', 'public.guard_review19_records_update()', 'EXECUTE'
  ) or has_function_privilege(
    'anon', 'public.set_review19_records_updated_at()', 'EXECUTE'
  ) then
    raise exception 'anon can directly execute a cloud sync trigger function';
  end if;
end;
$$;

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('area_count_records', 'review19_records')
order by table_name, ordinal_position;

select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('area_count_records', 'review19_records')
order by tablename, indexname;

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('area_count_records', 'review19_records')
order by tablename, policyname;

select table_name, constraint_name, constraint_type
from information_schema.table_constraints
where table_schema = 'public'
  and table_name in ('area_count_records', 'review19_records')
order by table_name, constraint_name;

select event_object_table, trigger_name, event_manipulation
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in ('area_count_records', 'review19_records')
order by event_object_table, trigger_name;
