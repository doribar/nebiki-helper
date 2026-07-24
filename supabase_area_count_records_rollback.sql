-- 移行後に問題が見つかった場合だけ実行します。
-- バックアップの旧列を同じidの行へ戻します。移行後の新規行は残り、旧列はNULLになります。

begin;

do $$
begin
  if to_regclass('public.area_count_records_backup_20260724') is null then
    raise exception 'backup table is missing; rollback cannot continue';
  end if;
end;
$$;

lock table public.area_count_records in access exclusive mode;

alter table public.area_count_records
  add column if not exists weekday_base text,
  add column if not exists comfort_point integer,
  add column if not exists user_judge text,
  add column if not exists suggested_evaluation text,
  add column if not exists area_rate_adjustment integer,
  add column if not exists evaluation_source text,
  add column if not exists decision_basis jsonb;

update public.area_count_records as current
set
  weekday_base = backup.weekday_base,
  comfort_point = backup.comfort_point,
  user_judge = backup.user_judge,
  suggested_evaluation = backup.suggested_evaluation,
  area_rate_adjustment = backup.area_rate_adjustment,
  evaluation_source = backup.evaluation_source,
  decision_basis = backup.decision_basis
from public.area_count_records_backup_20260724 as backup
where current.id = backup.id;

alter table public.area_count_records
  drop column if exists build_id;

alter table public.area_count_records
  drop constraint if exists area_count_records_weekday_base_check,
  drop constraint if exists area_count_records_comfort_point_check,
  drop constraint if exists area_count_records_user_judge_check,
  drop constraint if exists area_count_records_suggested_evaluation_check,
  drop constraint if exists area_count_records_area_rate_adjustment_check,
  drop constraint if exists area_count_records_evaluation_source_check;

alter table public.area_count_records
  add constraint area_count_records_weekday_base_check
    check (weekday_base in ('日', '金土', '火木', '月水')),
  add constraint area_count_records_comfort_point_check
    check (comfort_point between -1 and 3),
  add constraint area_count_records_user_judge_check
    check (user_judge in ('many', 'slightly_many', 'normal', 'slightly_few', 'few')),
  add constraint area_count_records_suggested_evaluation_check
    check (suggested_evaluation in ('many', 'slightly_many', 'normal', 'slightly_few', 'few')),
  add constraint area_count_records_area_rate_adjustment_check
    check (area_rate_adjustment in (-10, -5, 0, 5, 10)),
  add constraint area_count_records_evaluation_source_check
    check (evaluation_source in ('manual', 'history'));

notify pgrst, 'reload schema';

commit;

select
  (select count(*) from public.area_count_records) as restored_row_count,
  (select count(*) from public.area_count_records_backup_20260724) as backup_row_count;
