import type { AreaId, AreaJudge, DiscountTime, WeekdayBaseLabel } from "./types";

export type AreaCountDiscountTime = DiscountTime;

export type AreaCountRecord = {
  date: string;
  sessionStartedAt: string;
  recordedAt: string;
  areaId: AreaId;
  discountTime: AreaCountDiscountTime;
  weekdayBase: WeekdayBaseLabel;
  count: number;
  userJudge: Exclude<AreaJudge, null>;
};

export type AreaCountRecommendation = {
  status: "disabled" | "insufficient" | "ready";
  count: number;
  sampleSize: number;
  requiredSampleSize: number;
  matchedRecords: AreaCountRecord[];
  medianCount?: number;
  tolerance?: number;
  lowerThreshold?: number;
  upperThreshold?: number;
  suggestedJudge?: Exclude<AreaJudge, null>;
  summaryText: string;
  detailLines: string[];
};

const REQUIRED_SAMPLE_SIZE = 3;
const MAX_REFERENCE_RECORDS = 20;

export function isAreaCountAssistDiscountTime(
  discountTime: DiscountTime | undefined | null,
): discountTime is AreaCountDiscountTime {
  return (
    discountTime === "15" ||
    discountTime === "17" ||
    discountTime === "18" ||
    discountTime === "19" ||
    discountTime === "20"
  );
}

export function isAreaCountAssistTarget(params: {
  areaId: AreaId | null | undefined;
  discountTime: DiscountTime | undefined | null;
}): params is { areaId: AreaId; discountTime: AreaCountDiscountTime } {
  if (!params.areaId || !isAreaCountAssistDiscountTime(params.discountTime)) return false;

  // 寿司は17時も含めて検証する。
  // 15時〜16時40分は売場に追加する可能性があるため、15時は対象外にする。
  // 20時30分は最終値引画面でエリア判定を行わないため、ここでは対象外にする。
  if (params.areaId === "sushi") {
    return params.discountTime === "17" || params.discountTime === "18" || params.discountTime === "19";
  }

  return params.discountTime === "18" || params.discountTime === "19";
}

function cloneAreaCountRecord(record: AreaCountRecord): AreaCountRecord {
  return {
    date: record.date,
    sessionStartedAt: record.sessionStartedAt,
    recordedAt: record.recordedAt,
    areaId: record.areaId,
    discountTime: record.discountTime,
    weekdayBase: record.weekdayBase,
    count: record.count,
    userJudge: record.userJudge,
  };
}

export function cloneAreaCountRecords(records: AreaCountRecord[]): AreaCountRecord[] {
  return records.map(cloneAreaCountRecord);
}

export function normalizeAreaCountRecords(raw: unknown): AreaCountRecord[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item): AreaCountRecord[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<AreaCountRecord>;

    if (typeof record.date !== "string") return [];
    if (typeof record.sessionStartedAt !== "string") return [];
    if (typeof record.recordedAt !== "string") return [];
    if (typeof record.areaId !== "string") return [];
    if (!isAreaCountAssistDiscountTime(record.discountTime)) return [];
    if (
      record.weekdayBase !== "日" &&
      record.weekdayBase !== "金土" &&
      record.weekdayBase !== "火木" &&
      record.weekdayBase !== "月水"
    ) {
      return [];
    }
    if (typeof record.count !== "number" || !Number.isFinite(record.count) || record.count < 0) return [];
    if (
      record.userJudge !== "many" &&
      record.userJudge !== "normal" &&
      record.userJudge !== "few"
    ) {
      return [];
    }

    return [
      {
        date: record.date,
        sessionStartedAt: record.sessionStartedAt,
        recordedAt: record.recordedAt,
        areaId: record.areaId as AreaId,
        discountTime: record.discountTime,
        weekdayBase: record.weekdayBase,
        count: Math.round(record.count),
        userJudge: record.userJudge,
      },
    ];
  });
}

export function upsertAreaCountRecord(
  records: AreaCountRecord[],
  nextRecord: AreaCountRecord,
): AreaCountRecord[] {
  const filtered = records.filter((record) => {
    return !(
      record.date === nextRecord.date &&
      record.sessionStartedAt === nextRecord.sessionStartedAt &&
      record.areaId === nextRecord.areaId &&
      record.discountTime === nextRecord.discountTime
    );
  });

  return [...filtered, cloneAreaCountRecord(nextRecord)].sort((a, b) => {
    return a.recordedAt.localeCompare(b.recordedAt);
  });
}

function getMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const center = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[center];
  return Math.round((sorted[center - 1] + sorted[center]) / 2);
}

function judgeText(judge: Exclude<AreaJudge, null>): string {
  switch (judge) {
    case "many":
      return "多い";
    case "normal":
      return "どちらでもない";
    case "few":
      return "少ない";
  }
}

export function getAreaCountRecommendation(params: {
  records: AreaCountRecord[];
  areaId: AreaId | null;
  discountTime: DiscountTime | null | undefined;
  weekdayBase: WeekdayBaseLabel | null | undefined;
  count: number;
}): AreaCountRecommendation {
  const requiredSampleSize = REQUIRED_SAMPLE_SIZE;
  const count = Math.max(0, Math.round(params.count));

  if (
    !params.weekdayBase ||
    !isAreaCountAssistTarget({
      areaId: params.areaId,
      discountTime: params.discountTime,
    })
  ) {
    return {
      status: "disabled",
      count,
      sampleSize: 0,
      requiredSampleSize,
      matchedRecords: [],
      summaryText: "このエリア・時刻ではエリア残数判定は使いません。",
      detailLines: ["通常は18時30分・19時30分、寿司エリアは17時も検証対象です。"],
    };
  }

  const matchedRecords = params.records
    .filter((record) => {
      return (
        record.areaId === params.areaId &&
        record.discountTime === params.discountTime &&
        record.weekdayBase === params.weekdayBase
      );
    })
    .slice(-MAX_REFERENCE_RECORDS);

  if (matchedRecords.length < requiredSampleSize) {
    return {
      status: "insufficient",
      count,
      sampleSize: matchedRecords.length,
      requiredSampleSize,
      matchedRecords,
      summaryText: `過去データ ${matchedRecords.length}/${requiredSampleSize}件`,
      detailLines: [
        "同じエリア・同じ時刻・同じ曜日基準の記録が3件たまると判定します。",
        `今回の${count}個も、判定後に履歴へ保存されます。`,
      ],
    };
  }

  const medianCount = getMedian(matchedRecords.map((record) => record.count));
  const tolerance = Math.max(2, Math.ceil(medianCount * 0.2));
  const lowerThreshold = Math.max(0, medianCount - tolerance);
  const upperThreshold = medianCount + tolerance;

  let suggestedJudge: Exclude<AreaJudge, null> = "normal";
  if (count >= upperThreshold) {
    suggestedJudge = "many";
  } else if (count <= lowerThreshold) {
    suggestedJudge = "few";
  }

  return {
    status: "ready",
    count,
    sampleSize: matchedRecords.length,
    requiredSampleSize,
    matchedRecords,
    medianCount,
    tolerance,
    lowerThreshold,
    upperThreshold,
    suggestedJudge,
    summaryText: `おすすめ：${judgeText(suggestedJudge)}`,
    detailLines: [
      `過去中央値：${medianCount}個（同条件${matchedRecords.length}件）`,
      `少ない目安：${lowerThreshold}個以下 / 多い目安：${upperThreshold}個以上`,
      `今回：${count}個`,
    ],
  };
}
