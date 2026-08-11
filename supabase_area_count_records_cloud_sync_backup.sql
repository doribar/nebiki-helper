-- Cloud sync migration backup (run 1/4).
-- This script only creates private backup tables. It does not update or delete source rows.
-- Run it immediately before supabase_area_count_records_cloud_sync_migration.sql.
-- For an off-project copy, use the Supabase dashboard CSV export for both source and
-- backup tables after this transaction commits.

begin;

do $$
begin
  if to_regclass('public.area_count_records') is null then
    raise exception 'public.area_count_records does not exist';
  end if;

  if to_regclass('public.area_count_records_backup_20260809_cloud_sync') is not null then
    raise exception 'public.area_count_records_backup_20260809_cloud_sync already exists';
  end if;
end;
$$;

-- SHARE conflicts with writers, so the copy and its checks observe one stable table.
lock table public.area_count_records in share mode;

create table public.area_count_records_backup_20260809_cloud_sync
  (like public.area_count_records including all);

insert into public.area_count_records_backup_20260809_cloud_sync
select * from public.area_count_records;

revoke all on table public.area_count_records_backup_20260809_cloud_sync
  from public, anon, authenticated;
alter table public.area_count_records_backup_20260809_cloud_sync
  enable row level security;

do $$
declare
  source_count bigint;
  backup_count bigint;
begin
  select count(*) into source_count from public.area_count_records;
  select count(*) into backup_count
  from public.area_count_records_backup_20260809_cloud_sync;

  if source_count <> backup_count then
    raise exception 'area_count_records backup row count mismatch: source %, backup %',
      source_count, backup_count;
  end if;

  if exists (
    (
      select * from public.area_count_records
      except all
      select * from public.area_count_records_backup_20260809_cloud_sync
    )
    union all
    (
      select * from public.area_count_records_backup_20260809_cloud_sync
      except all
      select * from public.area_count_records
    )
  ) then
    raise exception 'area_count_records backup contents differ from source';
  end if;
end;
$$;

-- Normally review19_records does not exist before this migration. If a prior attempt
-- created it, preserve that table too and stop the migration later for manual review.
do $$
declare
  source_count bigint;
  backup_count bigint;
begin
  if to_regclass('public.review19_records') is null then
    return;
  end if;

  if to_regclass('public.review19_records_backup_20260809_cloud_sync') is not null then
    raise exception 'public.review19_records_backup_20260809_cloud_sync already exists';
  end if;

  execute 'lock table public.review19_records in share mode';
  execute 'create table public.review19_records_backup_20260809_cloud_sync
    (like public.review19_records including all)';
  execute 'insert into public.review19_records_backup_20260809_cloud_sync
    select * from public.review19_records';
  execute 'revoke all on table public.review19_records_backup_20260809_cloud_sync
    from public, anon, authenticated';
  execute 'alter table public.review19_records_backup_20260809_cloud_sync
    enable row level security';

  execute 'select count(*) from public.review19_records' into source_count;
  execute 'select count(*) from public.review19_records_backup_20260809_cloud_sync'
    into backup_count;
  if source_count <> backup_count then
    raise exception 'review19_records backup row count mismatch: source %, backup %',
      source_count, backup_count;
  end if;
end;
$$;

commit;

select
  (select count(*) from public.area_count_records) as source_row_count,
  (select count(*)
   from public.area_count_records_backup_20260809_cloud_sync) as backup_row_count,
  to_regclass('public.review19_records_backup_20260809_cloud_sync')
    as optional_review19_backup;
