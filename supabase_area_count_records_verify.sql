-- 適用順 3/3: 移行後検証。例外が出なければ完了です。

do $$
declare
  source_count bigint;
  backup_count bigint;
begin
  if to_regclass('public.area_count_records_backup_20260724') is null then
    raise exception 'backup table is missing';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'area_count_records'
      and column_name not in (
        'id', 'data_schema_version', 'app_version', 'build_id', 'date',
        'session_started_at', 'recorded_at', 'area_id', 'discount_time',
        'actual_weekday', 'actual_weekday_group', 'count', 'created_at', 'updated_at'
      )
  ) then
    raise exception 'unexpected columns remain in public.area_count_records';
  end if;

  if exists (
    select expected.column_name
    from (values
      ('id'), ('data_schema_version'), ('app_version'), ('build_id'), ('date'),
      ('session_started_at'), ('recorded_at'), ('area_id'), ('discount_time'),
      ('actual_weekday'), ('actual_weekday_group'), ('count'), ('created_at'), ('updated_at')
    ) as expected(column_name)
    except
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'area_count_records'
  ) then
    raise exception 'required columns are missing from public.area_count_records';
  end if;

  select count(*) into source_count from public.area_count_records;
  select count(*) into backup_count from public.area_count_records_backup_20260724;
  if source_count <> backup_count then
    raise exception 'row count mismatch: current %, backup %', source_count, backup_count;
  end if;

  if exists (
    (
      select id, data_schema_version, app_version, date, session_started_at,
        recorded_at, area_id, discount_time, actual_weekday,
        actual_weekday_group, count, created_at, updated_at
      from public.area_count_records_backup_20260724
      except
      select id, data_schema_version, app_version, date, session_started_at,
        recorded_at, area_id, discount_time, actual_weekday,
        actual_weekday_group, count, created_at, updated_at
      from public.area_count_records
    )
    union all
    (
      select id, data_schema_version, app_version, date, session_started_at,
        recorded_at, area_id, discount_time, actual_weekday,
        actual_weekday_group, count, created_at, updated_at
      from public.area_count_records
      except
      select id, data_schema_version, app_version, date, session_started_at,
        recorded_at, area_id, discount_time, actual_weekday,
        actual_weekday_group, count, created_at, updated_at
      from public.area_count_records_backup_20260724
    )
  ) then
    raise exception 'retained column data differs from backup';
  end if;

  if exists (
    select 1
    from public.area_count_records
    group by date, session_started_at, area_id, discount_time
    having count(*) > 1
  ) then
    raise exception 'duplicate upsert keys found';
  end if;

  if not exists (
    select 1
    from pg_class as table_class
    join pg_namespace as namespace on namespace.oid = table_class.relnamespace
    where namespace.nspname = 'public'
      and table_class.relname = 'area_count_records'
      and table_class.relrowsecurity
  ) then
    raise exception 'row level security is not enabled';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'area_count_records'
      and policyname in (
        'area_count_records_select',
        'area_count_records_insert',
        'area_count_records_update'
      )
  ) <> 3 then
    raise exception 'required RLS policies are missing';
  end if;

  if not exists (
    select 1
    from information_schema.triggers
    where event_object_schema = 'public'
      and event_object_table = 'area_count_records'
      and trigger_name = 'set_area_count_records_updated_at'
  ) then
    raise exception 'updated_at trigger is missing';
  end if;

  if (
    select count(*)
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'area_count_records'
      and indexname in (
        'area_count_records_lookup_idx',
        'area_count_records_group_lookup_idx'
      )
  ) <> 2 then
    raise exception 'history lookup indexes are missing';
  end if;
end;
$$;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'area_count_records'
order by ordinal_position;

select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'area_count_records'
order by indexname;

select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'area_count_records'
order by policyname;

select trigger_name, event_manipulation
from information_schema.triggers
where event_object_schema = 'public' and event_object_table = 'area_count_records'
order by trigger_name;
