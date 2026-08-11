-- Conservative cloud sync rollback (run only after reverting/deactivating the new app).
--
-- DATA-LOSS WARNING:
-- * A legacy client cannot distinguish normal and summer rows.
-- * Dropping demand_cycle, record_details, or review19_records would destroy evidence.
-- * Recreating the four-column key while summer rows exist can collide or mix cycles.
--
-- Therefore this rollback aborts if any summer area row exists, preserves the additive
-- area columns, and RENAMES (never drops) review19_records into a private quarantine.
-- Export the quarantine (including source_updated_at) and record_details before any
-- later destructive cleanup.

begin;

do $$
begin
  if to_regclass('public.area_count_records_backup_20260809_cloud_sync') is null then
    raise exception 'cloud sync backup is missing; rollback cannot continue';
  end if;
  if to_regclass('public.area_count_records') is null then
    raise exception 'public.area_count_records is missing';
  end if;
  if to_regclass('public.review19_records') is null then
    raise exception 'public.review19_records is missing';
  end if;
  if to_regclass('public.review19_records_quarantine_20260809_cloud_sync') is not null then
    raise exception 'review19 quarantine table already exists';
  end if;
end;
$$;

lock table public.area_count_records in access exclusive mode;
lock table public.review19_records in access exclusive mode;

do $$
declare
  four_column_key_count integer;
begin
  if exists (
    select 1 from public.area_count_records where demand_cycle <> 'normal'
  ) then
    raise exception 'summer area rows exist; export/migrate them before legacy rollback';
  end if;

  if exists (
    select 1 from public.area_count_records
    group by date, session_started_at, area_id, discount_time
    having count(*) > 1
  ) then
    raise exception 'four-column collisions exist; legacy uniqueness cannot be restored';
  end if;

  select count(*) into four_column_key_count
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
  if four_column_key_count <> 0 then
    raise exception 'a four-column unique key already exists; inspect partial rollback';
  end if;
end;
$$;

-- Add the legacy arbiter first, then remove the cloud arbiter: no uniqueness gap.
alter table public.area_count_records
  add constraint area_count_records_legacy_upsert_key
  unique (date, session_started_at, area_id, discount_time);

alter table public.area_count_records
  drop constraint area_count_records_cloud_sync_key;

drop trigger if exists guard_area_count_records_cloud_sync_update
  on public.area_count_records;
drop index if exists public.area_count_records_cycle_lookup_idx;
drop index if exists public.area_count_records_cycle_group_lookup_idx;

-- Keep every Review19 row but remove the public REST surface and anonymous grants.
alter table public.review19_records
  rename to review19_records_quarantine_20260809_cloud_sync;
revoke all on table public.review19_records_quarantine_20260809_cloud_sync
  from public, anon, authenticated;
revoke all on sequence public.review19_records_id_seq
  from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;

select
  to_regclass('public.review19_records') as live_review19_table,
  to_regclass('public.review19_records_quarantine_20260809_cloud_sync')
    as preserved_review19_table,
  (select max(source_updated_at)
   from public.review19_records_quarantine_20260809_cloud_sync)
    as newest_preserved_review19_source_update,
  (select count(*) from public.area_count_records) as preserved_area_row_count;

-- Intentionally not executed here:
--   alter table public.area_count_records drop column demand_cycle, drop column record_details;
--   drop table public.review19_records_quarantine_20260809_cloud_sync;
-- Those operations are irreversible and require a separately approved retention/export plan.
