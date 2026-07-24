-- 適用順 2/3: build_id追加と不要列削除。
-- 必ず supabase_area_count_records_backup.sql の成功後に実行してください。
-- idは内部主キーとして維持します。

begin;

do $$
begin
  if to_regclass('public.area_count_records_backup_20260724') is null then
    raise exception 'backup table is missing; run backup SQL first';
  end if;
end;
$$;

lock table public.area_count_records in access exclusive mode;

do $$
declare
  source_count bigint;
  backup_count bigint;
begin
  select count(*) into source_count from public.area_count_records;
  select count(*) into backup_count from public.area_count_records_backup_20260724;
  if source_count <> backup_count then
    raise exception 'table changed after backup: current %, backup %; create a fresh backup',
      source_count, backup_count;
  end if;
end;
$$;

alter table public.area_count_records
  add column if not exists build_id text;

alter table public.area_count_records
  drop column if exists weekday_base,
  drop column if exists comfort_point,
  drop column if exists user_judge,
  drop column if exists suggested_evaluation,
  drop column if exists area_rate_adjustment,
  drop column if exists evaluation_source,
  drop column if exists decision_basis;

alter table public.area_count_records
  drop constraint if exists area_count_records_actual_weekday_group_check;

alter table public.area_count_records
  add constraint area_count_records_actual_weekday_group_check
  check (
    actual_weekday_group in (
      '月水', '火木', '金土日', '火木日', '金土', '三連休中日', '翌日平日祝日'
    )
  );

notify pgrst, 'reload schema';

commit;
