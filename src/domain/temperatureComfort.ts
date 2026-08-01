import type {
  DiscountTime,
  TempLevel,
  TemperatureComfortAnalysis,
} from "./types.ts";

export type PreviousTemperatureObservation = {
  date: string;
  discountTime: DiscountTime;
  tempLevel: TempLevel;
  temperatureFalling: boolean;
};

type EvaluateTemperatureComfortParams = {
  date: string;
  discountTime: DiscountTime;
  tempLevel: TempLevel;
  previous?: PreviousTemperatureObservation | null;
};

const TEMP_LEVELS = new Set<TempLevel>([
  "5orLess",
  "6to10",
  "11to15",
  "16to20",
  "21to25",
  "26to27",
  "28to30",
  "26to30",
  "31to33",
  "34to35",
  "31to35",
  "36orMore",
]);

/**
 * Hot-side bands ordered from hotter to more comfortable.
 * Legacy aggregate bands intentionally have no ordinal: their exact position
 * cannot be reconstructed safely without an actual temperature.
 */
const HOT_SIDE_BAND_ORDER = new Map<TempLevel, number>([
  ["36orMore", 0],
  ["34to35", 1],
  ["31to33", 2],
  ["28to30", 3],
  ["26to27", 4],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTempLevel(value: unknown): value is TempLevel {
  return typeof value === "string" && TEMP_LEVELS.has(value as TempLevel);
}

function isDiscountTime(value: unknown): value is DiscountTime {
  return ["15", "17", "18", "19", "20"].includes(String(value));
}

export function getTemperaturePoint(tempLevel: TempLevel): number {
  switch (tempLevel) {
    case "5orLess":
      return 2;
    case "6to10":
      return 1;
    case "11to15":
      return 0;
    case "16to20":
      return -1;
    case "21to25":
      return -2;
    case "26to27":
    case "26to30":
      return -1;
    case "28to30":
      return 0;
    case "31to33":
    case "34to35":
    case "31to35":
      return 1;
    case "36orMore":
      return 2;
  }
}

export function evaluateTemperatureComfort(
  params: EvaluateTemperatureComfortParams,
): TemperatureComfortAnalysis {
  const previous =
    params.previous?.date === params.date ? params.previous : null;
  const originalTemperaturePoint = getTemperaturePoint(params.tempLevel);
  const previousBandOrder = previous
    ? HOT_SIDE_BAND_ORDER.get(previous.tempLevel)
    : undefined;
  const currentBandOrder = HOT_SIDE_BAND_ORDER.get(params.tempLevel);
  const canCompareHotSideBands =
    previousBandOrder !== undefined && currentBandOrder !== undefined;

  let temperatureFalling = false;
  if (params.discountTime !== "15" && previous && canCompareHotSideBands) {
    if (previous.temperatureFalling) {
      temperatureFalling = currentBandOrder >= previousBandOrder;
    } else {
      temperatureFalling = currentBandOrder > previousBandOrder;
    }
  }

  const temperaturePointSuppressed =
    temperatureFalling && originalTemperaturePoint > 0;
  const appliedTemperaturePoint = temperaturePointSuppressed
    ? 0
    : originalTemperaturePoint;

  return {
    version: 1,
    originalTemperaturePoint,
    appliedTemperaturePoint,
    temperatureFalling,
    previousTemperatureFalling: previous?.temperatureFalling ?? false,
    previousTempLevel: previous?.tempLevel ?? null,
    previousDiscountTime: previous?.discountTime ?? null,
    currentTempLevel: params.tempLevel,
    temperaturePointSuppressed,
  };
}

export function normalizeTemperatureComfortAnalysis(
  raw: unknown,
): TemperatureComfortAnalysis | undefined {
  if (!isRecord(raw) || raw.version !== 1) return undefined;
  if (
    typeof raw.originalTemperaturePoint !== "number" ||
    !Number.isFinite(raw.originalTemperaturePoint) ||
    typeof raw.appliedTemperaturePoint !== "number" ||
    !Number.isFinite(raw.appliedTemperaturePoint) ||
    typeof raw.temperatureFalling !== "boolean" ||
    typeof raw.previousTemperatureFalling !== "boolean" ||
    !(
      raw.previousTempLevel === null || isTempLevel(raw.previousTempLevel)
    ) ||
    !(
      raw.previousDiscountTime === null ||
      isDiscountTime(raw.previousDiscountTime)
    ) ||
    !isTempLevel(raw.currentTempLevel) ||
    typeof raw.temperaturePointSuppressed !== "boolean"
  ) {
    return undefined;
  }

  const originalTemperaturePoint = getTemperaturePoint(raw.currentTempLevel);
  const expectedAppliedTemperaturePoint =
    raw.temperaturePointSuppressed && originalTemperaturePoint > 0
      ? 0
      : originalTemperaturePoint;
  if (
    raw.originalTemperaturePoint !== originalTemperaturePoint ||
    raw.appliedTemperaturePoint !== expectedAppliedTemperaturePoint ||
    raw.temperaturePointSuppressed !==
      (raw.temperatureFalling && originalTemperaturePoint > 0)
  ) {
    return undefined;
  }

  return {
    version: 1,
    originalTemperaturePoint: raw.originalTemperaturePoint,
    appliedTemperaturePoint: raw.appliedTemperaturePoint,
    temperatureFalling: raw.temperatureFalling,
    previousTemperatureFalling: raw.previousTemperatureFalling,
    previousTempLevel: raw.previousTempLevel,
    previousDiscountTime: raw.previousDiscountTime,
    currentTempLevel: raw.currentTempLevel,
    temperaturePointSuppressed: raw.temperaturePointSuppressed,
  };
}
