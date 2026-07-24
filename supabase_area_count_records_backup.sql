-- 適用順 1/3: 既存テーブルの退避。
-- SQL Editorで migration より先に1回だけ実行してください。
-- 同名バックアップがある場合は上書きせず停止します。

begin;

do $$
begin
  if to_regclass('public.area_count_records') is null then
    raise exception 'public.area_count_records does not exist';
  end if;
  if to_regclass('public.area_count_records_backup_20260724') is not null then
    raise exception 'backup table public.area_count_records_backup_20260724 already exists';
  end if;
end;
$$;

lock table public.area_count_records in share mode;

create table public.area_count_records_backup_20260724
  (like public.area_count_records including all);

insert into public.area_count_records_backup_20260724
select * from public.area_count_records;

-- バックアップをクライアントから直接参照できないようにします。
revoke all on table public.area_count_records_backup_20260724 from anon, authenticated;
alter table public.area_count_records_backup_20260724 enable row level security;

do $$
declare
  source_count bigint;
  backup_count bigint;
begin
  select count(*) into source_count from public.area_count_records;
  select count(*) into backup_count from public.area_count_records_backup_20260724;
  if source_count <> backup_count then
    raise exception 'backup row count mismatch: source %, backup %', source_count, backup_count;
  end if;
end;
$$;

commit;

select
  (select count(*) from public.area_count_records) as source_row_count,
  (select count(*) from public.area_count_records_backup_20260724) as backup_row_count;
