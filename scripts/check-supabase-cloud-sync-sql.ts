import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (filename: string) =>
  readFileSync(`${projectRoot}/${filename}`, "utf8");
const executableSql = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "");
const normalizedSqlWhitespace = (source: string) =>
  source.toLowerCase().replace(/\s+/g, " ");

const backup = read("supabase_area_count_records_cloud_sync_backup.sql");
const migration = read("supabase_area_count_records_cloud_sync_migration.sql");
const verify = read("supabase_area_count_records_cloud_sync_verify.sql");
const rollback = read("supabase_area_count_records_cloud_sync_rollback.sql");

assert.match(backup, /area_count_records_backup_20260809_cloud_sync/);
assert.match(backup, /like public\.area_count_records including all/i);
assert.match(backup, /except all/i);
assert.match(backup, /revoke all[\s\S]*from public, anon, authenticated/i);
assert.doesNotMatch(executableSql(backup), /\b(delete|truncate|drop table|update)\b/i);

assert.match(
  migration,
  /add column demand_cycle text not null default 'normal'/i,
);
assert.match(
  migration,
  /add column record_details jsonb not null default '\{\}'::jsonb/i,
);
assert.match(
  migration,
  /unique \(date, session_started_at, area_id, discount_time, demand_cycle\)/i,
);
assert.match(migration, /unnest\(constraint_entry\.conkey\) with ordinality/i);
assert.match(migration, /area_count_records_cycle_lookup_idx/i);
assert.match(migration, /area_count_records_cycle_group_lookup_idx/i);
assert.match(migration, /new\.recorded_at < old\.recorded_at/i);
assert.match(migration, /new\.recorded_at = old\.recorded_at/i);
assert.match(migration, /new := old/i);
assert.match(
  migration,
  /incoming_record_details\s*\|\| coalesce\(old\.record_details, '\{\}'::jsonb\)/i,
);
assert.match(
  migration,
  /incoming_human_evaluation ->> 'humanEvaluationScale' = '9'/i,
);
assert.match(
  migration,
  /existing_human_evaluation ->> 'humanEvaluationScale' = '9'/i,
);
assert.match(
  migration,
  /and not \([\s\S]*existing_human_evaluation ->> 'humanEvaluationScale' = '9'/i,
);
assert.match(
  migration,
  /jsonb_set\([\s\S]*'\{humanEvaluationDetails\}'[\s\S]*incoming_human_evaluation/i,
);
assert.match(
  migration,
  /coalesce\(old\.record_details, '\{\}'::jsonb\)\s*\|\| new\.record_details/i,
);
assert.match(migration, /create table public\.review19_records/i);
assert.match(migration, /recorded_at timestamptz,/i);
assert.match(migration, /source_updated_at timestamptz not null/i);
assert.match(migration, /is_complete boolean not null default false/i);
assert.match(migration, /payload jsonb not null default '\{\}'::jsonb/i);
assert.match(migration, /review19_records_source_timestamp_check/i);
assert.match(migration, /review19_records_payload_identity_check/i);
assert.match(migration, /payload ->> 'sessionStartedAt' = session_started_at/i);
assert.match(
  migration,
  /\(payload ->> 'sourceUpdatedAt'\)::timestamptz = source_updated_at/i,
);
assert.match(
  migration,
  /payload #>> '\{dataQuality,complete\}' = is_complete::text/i,
);
assert.match(
  migration,
  /jsonb_typeof\(payload #> '\{dataQuality,complete\}'\) = 'boolean',[\s\S]*false/i,
);
assert.match(
  migration,
  /source_updated_at >= session_started_at::timestamptz/i,
);
assert.doesNotMatch(migration, /review19_records_complete_payload_identity_check/i);
assert.match(migration, /unique \(date, demand_cycle\)/i);
assert.match(
  migration,
  /old\.recorded_at is not null and new\.recorded_at is null/i,
);
assert.match(
  migration,
  /new\.source_updated_at < old\.source_updated_at/i,
);
assert.match(
  migration,
  /new\.source_updated_at = old\.source_updated_at[\s\S]*old\.recorded_at is null[\s\S]*new\.recorded_at is not null/i,
);
assert.doesNotMatch(migration, /old\.is_complete and not new\.is_complete/i);
assert.doesNotMatch(migration, /review19_records_complete_recorded_at_check/i);
for (const operation of ["select", "insert", "update"]) {
  assert.match(
    migration,
    new RegExp(`create policy "review19_records_${operation}"`, "i"),
  );
}
assert.doesNotMatch(executableSql(migration), /for delete/i);
assert.match(
  migration,
  /revoke all on table public\.review19_records from public, anon, authenticated/i,
);
assert.doesNotMatch(executableSql(migration), /grant all/i);
assert.match(migration, /revoke execute on function public\.guard_review19_records_update/i);

const newKeyPosition = migration.indexOf(
  "add constraint area_count_records_cloud_sync_key",
);
const legacyDropPosition = migration.indexOf(
  "alter table public.area_count_records drop constraint %I",
);
assert.ok(newKeyPosition >= 0 && legacyDropPosition > newKeyPosition);

const staleBranchPosition = migration.indexOf(
  "new.recorded_at < old.recorded_at",
);
const equalBranchPosition = migration.indexOf(
  "new.recorded_at = old.recorded_at",
);
const newerMergePosition = migration.indexOf(
  "coalesce(old.record_details, '{}'::jsonb)\n      || new.record_details",
);
assert.ok(
  staleBranchPosition >= 0 &&
    equalBranchPosition > staleBranchPosition &&
    newerMergePosition > equalBranchPosition,
);

for (const requiredCheck of [
  "legacy rows were not backfilled as normal with empty details",
  "legacy four-column unique key still exists",
  "duplicate five-column area_count_records keys exist",
  "cycle-aware area_count_records indexes are missing",
  "review19_records constraints are missing or unvalidated",
  "review19_records RLS policies are wrong",
]) {
  assert.match(verify, new RegExp(requiredCheck));
}
assert.match(verify, /has_table_privilege\('anon'/i);
assert.match(verify, /has_sequence_privilege\(/i);
assert.match(verify, /has_function_privilege\(/i);
assert.match(verify, /not least-privilege/i);
assert.match(verify, /recorded_at.*timestamp with time zone[\s\S]*is_nullable = 'YES'/i);
assert.match(
  verify,
  /source_updated_at'[\s\S]*timestamp with time zone'[\s\S]*is_nullable = 'NO'/i,
);
assert.doesNotMatch(verify, /review19_records_complete_recorded_at_check/i);
assert.match(verify, /sourceupdatedat%source_updated_at/i);

const review19MigrationGuard = migration.match(
  /create or replace function public\.guard_review19_records_update\(\)[\s\S]*?\n\$\$;/i,
)?.[0];
assert.ok(review19MigrationGuard, "review19 migration guard function is missing");
assert.match(
  review19MigrationGuard,
  /old\.recorded_at is null\s+and new\.recorded_at is not null/i,
  "the regression fixture must keep the real multiline partial-to-final guard",
);

const normalizedReview19MigrationGuard = normalizedSqlWhitespace(
  review19MigrationGuard,
);
for (const requiredGuard of [
  "old.recorded_at is not null and new.recorded_at is null",
  "new.source_updated_at < old.source_updated_at",
  "new.source_updated_at = old.source_updated_at",
  "old.recorded_at is null and new.recorded_at is not null",
]) {
  assert.ok(
    normalizedReview19MigrationGuard.includes(requiredGuard),
    `review19 migration guard is missing: ${requiredGuard}`,
  );
}

const review19VerifyFunctionPosition = verify.indexOf(
  "function_entry.proname = 'guard_review19_records_update'",
);
const review19VerifyGuardStart = verify.lastIndexOf(
  "if not exists (",
  review19VerifyFunctionPosition,
);
const review19VerifyGuardEndMarker =
  "raise exception 'review19_records final/freshness guard definition is wrong';";
const review19VerifyGuardEnd = verify.indexOf(
  review19VerifyGuardEndMarker,
  review19VerifyFunctionPosition,
);
assert.ok(
  review19VerifyFunctionPosition >= 0 &&
    review19VerifyGuardStart >= 0 &&
    review19VerifyGuardEnd >= 0,
  "review19 verify guard block is missing",
);
const review19VerifyGuard = verify.slice(
  review19VerifyGuardStart,
  review19VerifyGuardEnd + review19VerifyGuardEndMarker.length,
);
assert.match(
  review19VerifyGuard,
  /regexp_replace\([\s\S]*lower\(pg_get_functiondef\(function_entry\.oid\)\)[\s\S]*'\[\[:space:\]\]\+'[\s\S]*'g'[\s\S]*as normalized_definition/i,
  "verify must normalize PL/pgSQL whitespace before checking the guard",
);
assert.doesNotMatch(
  review19VerifyGuard,
  /lower\(pg_get_functiondef\(function_entry\.oid\)\)\s+like/i,
  "verify must not compare the raw multiline function definition",
);
for (const requiredGuard of [
  "old.recorded_at is not null and new.recorded_at is null",
  "new.source_updated_at < old.source_updated_at",
  "new.source_updated_at = old.source_updated_at",
  "old.recorded_at is null and new.recorded_at is not null",
]) {
  assert.match(
    review19VerifyGuard,
    new RegExp(
      `function_definition\\.normalized_definition\\s+like '%${requiredGuard.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      )}%'`,
      "i",
    ),
    `verify must retain the normalized guard check: ${requiredGuard}`,
  );
}

assert.match(rollback, /where demand_cycle <> 'normal'/i);
assert.match(rollback, /having count\(\*\) > 1/i);
assert.match(
  rollback,
  /rename to review19_records_quarantine_20260809_cloud_sync/i,
);
assert.match(rollback, /revoke all on table/i);
assert.match(rollback, /max\(source_updated_at\)/i);
assert.doesNotMatch(executableSql(rollback), /\bdrop table\b/i);
assert.doesNotMatch(executableSql(rollback), /\bdrop column\b/i);

const legacyAddPosition = rollback.indexOf(
  "add constraint area_count_records_legacy_upsert_key",
);
const cloudDropPosition = rollback.indexOf(
  "drop constraint area_count_records_cloud_sync_key",
);
assert.ok(legacyAddPosition >= 0 && cloudDropPosition > legacyAddPosition);

for (const legacyFilename of [
  "supabase_area_count_records.sql",
  "supabase_area_count_records_backup.sql",
  "supabase_area_count_records_migration.sql",
  "supabase_area_count_records_verify.sql",
  "supabase_area_count_records_rollback.sql",
]) {
  const legacy = read(legacyFilename);
  assert.doesNotMatch(legacy, /review19_records/i, legacyFilename);
  assert.doesNotMatch(legacy, /record_details/i, legacyFilename);
}

console.log("Supabase cloud sync SQL static checks passed (5/5 artifacts)");
