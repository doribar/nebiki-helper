import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type {
  DiscountTime,
  DemandCycle,
  ForecastHourKey,
  ForecastWeatherKind,
  SessionData,
  SessionDraft,
} from "../../domain/types";
import {
  cloneHourlyForecasts,
  FORECAST_HOUR_KEYS,
  getForecastWeatherLabel,
  getForecastWeatherSymbol,
  getWeatherInputForecastHours,
} from "../../domain/hourlyWeather";
import {
  loadFixedTimeTemperatures,
  saveFixedTimeTemperature,
  saveFixedTimeTemperatures,
} from "../../domain/fixedTimeTemperatureMemory";
import {
  buildSameDayConfirmedHourlyWeather,
  buildWeatherConfirmationDisplayRows,
} from "../../domain/weatherConfirmationDisplay";
import { getDailySessionSnapshotsForDate } from "../../domain/storage";
import { ScreenHeader } from "../layout/ScreenHeader";
import { PrimaryButton } from "../layout/PrimaryButton";
import { WeatherConfirmationPanel } from "./WeatherConfirmationPanel";

type StartScreenProps = {
  sessionDraft: SessionDraft;
  previousSession: SessionData | null;
  isFixedTimeMode: boolean;
  weatherGuideText: {
    nearTermWeatherGuide: string;
    laterPrecipGuide: string;
    laterPrecipTypeGuide: string;
    windGuide: string;
    tempGuide: string;
  };
  showAfterRainRecoverySelector: boolean;
  onChangeSessionDraft: (patch: Partial<SessionDraft>) => void;
  weatherConfirmationPending: boolean;
  weatherCorrectionRequestId: number;
  onRequestWeatherConfirmation: () => void;
  onEditWeatherInput: () => void;
  onStart: () => void;
  startButtonLabel?: string;
  canStartReview19?: boolean;
  onStartReview19?: () => void;
  onReturnHome?: () => void;
  onOpenSettings?: () => void;
  previousDayDiscardTarget?: { date: string; count: number | null } | null;
  onSavePreviousDayDiscardCount?: (count: number | null) => void;
  demandCycle: DemandCycle;
  summerModeAvailable: boolean;
  canChangeDemandCycle: boolean;
  demandCycleChangeBlockedReason?: string | null;
  onChangeDemandCycle: (demandCycle: DemandCycle) => boolean;
  now?: Date;
};

const WEEKDAY_OPTIONS = [
  { value: 0, label: "日曜日" },
  { value: 1, label: "月曜日" },
  { value: 2, label: "火曜日" },
  { value: 3, label: "水曜日" },
  { value: 4, label: "木曜日" },
  { value: 5, label: "金曜日" },
  { value: 6, label: "土曜日" },
];

const DISCOUNT_TIME_OPTIONS: { value: DiscountTime; label: string }[] = [
  { value: "15", label: "15時" },
  { value: "17", label: "17時" },
  { value: "18", label: "18時30分" },
  { value: "19", label: "19時30分" },
  { value: "20", label: "20時30分" },
];

const TEMP_NUMBER_OPTIONS = Array.from({ length: 46 }, (_, index) => index - 5);
const WIND_NUMBER_OPTIONS = Array.from({ length: 16 }, (_, index) => index);
const FORECAST_WEATHER_ORDER: ForecastWeatherKind[] = ["sunny", "rain", "snow"];

function stepForecastWeather(
  current: ForecastWeatherKind,
  delta: 1 | -1,
): ForecastWeatherKind {
  const currentIndex = FORECAST_WEATHER_ORDER.indexOf(current);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex =
    (safeIndex + delta + FORECAST_WEATHER_ORDER.length) %
    FORECAST_WEATHER_ORDER.length;
  return FORECAST_WEATHER_ORDER[nextIndex];
}

function formatLocalDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function resolveDiscountTime(date = new Date()): DiscountTime {
  const minutes = date.getHours() * 60 + date.getMinutes();

  // 天候入力・値引開始準備の時刻で自動切替する。
  // 15時・17時は冷惣菜値引もあるため20分前、それ以降は5分前。
  if (minutes < 16 * 60 + 40) return "15";
  if (minutes < 18 * 60 + 25) return "17";
  if (minutes < 19 * 60 + 25) return "18";
  if (minutes < 20 * 60 + 25) return "19";
  return "20";
}

function getWeekdayLabel(weekday: number): string {
  const map = [
    "日曜日",
    "月曜日",
    "火曜日",
    "水曜日",
    "木曜日",
    "金曜日",
    "土曜日",
  ];
  return map[weekday] ?? "";
}

function getDiscountTimeLabel(discountTime: DiscountTime): string {
  const map: Record<DiscountTime, string> = {
    "15": "15時",
    "17": "17時",
    "18": "18時30分",
    "19": "19時30分",
    "20": "20時30分",
  };
  return map[discountTime];
}

function cycleIndex(
  length: number,
  currentIndex: number,
  delta: number,
): number {
  return (currentIndex + delta + length) % length;
}

function getWheelStep(deltaY: number): 1 | -1 {
  return deltaY > 0 ? 1 : -1;
}

function StartSectionLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontWeight: 800, marginBottom: 8 }}>{children}</div>;
}

function ForecastNumberStepper(props: {
  value: number;
  options: number[];
  unit: string;
  onChange: (next: number) => void;
  onConfirmCurrent?: () => void;
  isUnconfirmed?: boolean;
  disabled?: boolean;
}) {
  const currentIndex = props.options.indexOf(props.value);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const canDecrease = !props.disabled && safeIndex > 0;
  const canIncrease = !props.disabled && safeIndex < props.options.length - 1;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "30px 1fr 30px",
        gap: 4,
        alignItems: "center",
        justifyItems: "stretch",
      }}
    >
      <button
        type="button"
        onClick={() => {
          if (!canIncrease) return;
          props.onChange(props.options[safeIndex + 1]);
        }}
        disabled={!canIncrease}
        style={{
          height: 30,
          borderRadius: 8,
          border: "1px solid #ccc",
          background: canIncrease ? "#c62828" : "#f0f0f0",
          color: canIncrease ? "#fff" : "#999",
          fontWeight: 800,
          cursor: canIncrease ? "pointer" : "not-allowed",
        }}
      >
        +1
      </button>

      <button
        type="button"
        onClick={() => {
          if (props.disabled || !props.isUnconfirmed || !props.onConfirmCurrent)
            return;
          props.onConfirmCurrent();
        }}
        disabled={props.disabled}
        style={{
          minHeight: 34,
          borderRadius: 8,
          border: props.isUnconfirmed ? "2px dashed #aaa" : "1px solid #ccc",
          background: props.disabled ? "#f0f0f0" : "#fff",
          color: props.disabled ? "#999" : "#000",
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "4px",
          cursor: props.disabled
            ? "not-allowed"
            : props.isUnconfirmed
              ? "pointer"
              : "default",
        }}
      >
        {props.value}
        {props.unit}
      </button>

      <button
        type="button"
        onClick={() => {
          if (!canDecrease) return;
          props.onChange(props.options[safeIndex - 1]);
        }}
        disabled={!canDecrease}
        style={{
          height: 30,
          borderRadius: 8,
          border: "1px solid #ccc",
          background: canDecrease ? "#1565c0" : "#f0f0f0",
          color: canDecrease ? "#fff" : "#999",
          fontWeight: 800,
          cursor: canDecrease ? "pointer" : "not-allowed",
        }}
      >
        -1
      </button>
    </div>
  );
}

function ForecastWeatherStepper(props: {
  weather: ForecastWeatherKind;
  onChange: (next: ForecastWeatherKind) => void;
  onConfirmCurrent?: () => void;
  isUnconfirmed?: boolean;
  disabled?: boolean;
}) {
  const canAdjust = !props.disabled;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "30px 1fr 30px",
        gap: 4,
        alignItems: "center",
        justifyItems: "stretch",
      }}
    >
      <button
        type="button"
        onClick={() => {
          if (!canAdjust) return;
          props.onChange(stepForecastWeather(props.weather, 1));
        }}
        disabled={!canAdjust}
        style={{
          height: 30,
          borderRadius: 8,
          border: "1px solid #ccc",
          background: canAdjust ? "#c62828" : "#f0f0f0",
          color: canAdjust ? "#fff" : "#999",
          fontWeight: 800,
          cursor: canAdjust ? "pointer" : "not-allowed",
        }}
      >
        +1
      </button>

      <button
        type="button"
        onClick={() => {
          if (props.disabled || !props.isUnconfirmed || !props.onConfirmCurrent)
            return;
          props.onConfirmCurrent();
        }}
        disabled={props.disabled}
        style={{
          minHeight: 34,
          borderRadius: 8,
          border: props.isUnconfirmed ? "2px dashed #aaa" : "1px solid #ccc",
          background: props.disabled ? "#f0f0f0" : "#fff",
          color: props.disabled ? "#999" : "#000",
          fontWeight: 700,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "4px",
          cursor: props.disabled
            ? "not-allowed"
            : props.isUnconfirmed
              ? "pointer"
              : "default",
          gap: 2,
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>
          {getForecastWeatherSymbol(props.weather)}
        </span>
        <span style={{ fontSize: 12 }}>
          {getForecastWeatherLabel(props.weather)}
        </span>
      </button>

      <button
        type="button"
        onClick={() => {
          if (!canAdjust) return;
          props.onChange(stepForecastWeather(props.weather, -1));
        }}
        disabled={!canAdjust}
        style={{
          height: 30,
          borderRadius: 8,
          border: "1px solid #ccc",
          background: canAdjust ? "#1565c0" : "#f0f0f0",
          color: canAdjust ? "#fff" : "#999",
          fontWeight: 800,
          cursor: canAdjust ? "pointer" : "not-allowed",
        }}
      >
        -1
      </button>
    </div>
  );
}

const INPUT_FIELDS = ["weather", "temp", "wind"] as const;
type InputField = (typeof INPUT_FIELDS)[number];
type ForecastConfirmationMap = Record<
  ForecastHourKey,
  Record<InputField, boolean>
>;

function createEmptyConfirmationMap(): ForecastConfirmationMap {
  return FORECAST_HOUR_KEYS.reduce((acc, hour) => {
    acc[hour] = {
      weather: false,
      temp: false,
      wind: false,
    };
    return acc;
  }, {} as ForecastConfirmationMap);
}

function isHourAtOrAfter(hour: ForecastHourKey, startHour: ForecastHourKey) {
  return Number(hour) >= Number(startHour);
}

function getInputHoursForField(
  activeHours: ForecastHourKey[],
  field: InputField,
): ForecastHourKey[] {
  return field === "temp" ? [...activeHours].reverse() : activeHours;
}

function createFieldOrder(startHour: ForecastHourKey) {
  const activeHours = FORECAST_HOUR_KEYS.filter((hour) =>
    isHourAtOrAfter(hour, startHour),
  );
  return INPUT_FIELDS.flatMap((field) =>
    getInputHoursForField(activeHours, field).map((hour) => ({ hour, field })),
  );
}

function createCorrectionConfirmationMap(
  fieldOrder: ReturnType<typeof createFieldOrder>,
): ForecastConfirmationMap {
  const confirmations = createEmptyConfirmationMap();

  for (const { hour, field } of fieldOrder) {
    confirmations[hour][field] = true;
  }

  const finalTarget = fieldOrder.at(-1);
  if (finalTarget) {
    confirmations[finalTarget.hour][finalTarget.field] = false;
  }

  return confirmations;
}

export function StartScreen({
  sessionDraft,
  previousSession,
  isFixedTimeMode,
  weatherGuideText: _weatherGuideText,
  onChangeSessionDraft,
  weatherConfirmationPending,
  weatherCorrectionRequestId,
  onRequestWeatherConfirmation,
  onEditWeatherInput,
  onStart,
  startButtonLabel,
  canStartReview19 = false,
  onStartReview19,
  onReturnHome,
  onOpenSettings,
  previousDayDiscardTarget = null,
  onSavePreviousDayDiscardCount,
  demandCycle,
  summerModeAvailable,
  canChangeDemandCycle,
  demandCycleChangeBlockedReason = null,
  onChangeDemandCycle,
  now = new Date(),
}: StartScreenProps) {
  const isFinalTime = sessionDraft.discountTime === "20";
  const activeHours = useMemo(
    () => getWeatherInputForecastHours(sessionDraft.discountTime),
    [sessionDraft.discountTime],
  );
  const startForecastHour = activeHours[0];
  const displayHours = FORECAST_HOUR_KEYS;
  const fieldOrder = useMemo(
    () => createFieldOrder(startForecastHour),
    [startForecastHour],
  );
  const [confirmedInputs, setConfirmedInputs] =
    useState<ForecastConfirmationMap>(createEmptyConfirmationMap());
  const [fixedTimeTemperatures, setFixedTimeTemperatures] = useState<
    Partial<Record<ForecastHourKey, number>>
  >(() =>
    loadFixedTimeTemperatures({
      enabled: isFixedTimeMode,
      date: sessionDraft.date,
    }),
  );
  const [temperatureInputTouched, setTemperatureInputTouched] = useState<
    Partial<Record<ForecastHourKey, boolean>>
  >({});
  const [preferRestoredDraftTemperatures, setPreferRestoredDraftTemperatures] =
    useState(
      () =>
        isFixedTimeMode &&
        Boolean(sessionDraft.weatherInputLockedDiscountTime),
    );
  const fixedTemperatureScopeRef = useRef(
    `${isFixedTimeMode ? "fixed" : "normal"}:${sessionDraft.date}:${sessionDraft.discountTime}`,
  );
  const hourlyFieldRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const startButtonRef = useRef<HTMLButtonElement | null>(null);
  const [discardPanelOpen, setDiscardPanelOpen] = useState(false);
  const [discardCountText, setDiscardCountText] = useState("");
  const [discardMessage, setDiscardMessage] = useState<string | null>(null);
  const discountTimeOptions = DISCOUNT_TIME_OPTIONS;

  useEffect(() => {
    setConfirmedInputs(createEmptyConfirmationMap());
  }, [sessionDraft.discountTime, sessionDraft.date]);

  useEffect(() => {
    const nextScope = `${isFixedTimeMode ? "fixed" : "normal"}:${sessionDraft.date}:${sessionDraft.discountTime}`;
    if (fixedTemperatureScopeRef.current === nextScope) return;

    fixedTemperatureScopeRef.current = nextScope;
    setFixedTimeTemperatures(
      loadFixedTimeTemperatures({
        enabled: isFixedTimeMode,
        date: sessionDraft.date,
      }),
    );
    setTemperatureInputTouched({});
    setPreferRestoredDraftTemperatures(false);
  }, [isFixedTimeMode, sessionDraft.date, sessionDraft.discountTime]);

  const confirmedHourlyWeather = useMemo(() => {
    const snapshots =
      !weatherConfirmationPending ||
      isFixedTimeMode ||
      typeof localStorage === "undefined"
        ? []
        : getDailySessionSnapshotsForDate(sessionDraft.date);

    return buildSameDayConfirmedHourlyWeather({
      date: sessionDraft.date,
      snapshots,
      currentSession: previousSession,
    });
  }, [
    isFixedTimeMode,
    previousSession,
    sessionDraft.date,
    weatherConfirmationPending,
  ]);

  const weatherConfirmationRows = useMemo(
    () =>
      buildWeatherConfirmationDisplayRows({
        sessionDraft,
        activeHours,
        confirmedHourlyWeather,
        fixedTimeTemperatures: isFixedTimeMode
          ? fixedTimeTemperatures
          : {},
      }),
    [
      activeHours,
      confirmedHourlyWeather,
      fixedTimeTemperatures,
      isFixedTimeMode,
      sessionDraft,
    ],
  );

  useEffect(() => {
    setDiscardCountText(
      typeof previousDayDiscardTarget?.count === "number"
        ? String(previousDayDiscardTarget.count)
        : "",
    );
    setDiscardMessage(null);
  }, [previousDayDiscardTarget?.date, previousDayDiscardTarget?.count]);

  const currentUnlockIndex = fieldOrder.findIndex(
    ({ hour, field }: { hour: ForecastHourKey; field: InputField }) =>
      !confirmedInputs[hour][field],
  );
  const currentUnlockTarget =
    currentUnlockIndex >= 0 ? fieldOrder[currentUnlockIndex] : null;
  const allRequiredInputsConfirmed = currentUnlockIndex === -1;
  const wasAllRequiredInputsConfirmedRef = useRef(allRequiredInputsConfirmed);
  const previousWeatherCorrectionRequestIdRef = useRef(
    weatherCorrectionRequestId,
  );

  useEffect(() => {
    const previousRequestId = previousWeatherCorrectionRequestIdRef.current;
    previousWeatherCorrectionRequestIdRef.current = weatherCorrectionRequestId;

    if (previousRequestId === weatherCorrectionRequestId) return;
    setConfirmedInputs(createCorrectionConfirmationMap(fieldOrder));
  }, [fieldOrder, weatherCorrectionRequestId]);

  useEffect(() => {
    if (!currentUnlockTarget) return;

    const key = `${currentUnlockTarget.field}-${currentUnlockTarget.hour}`;
    const target = hourlyFieldRefs.current[key];
    if (!target) return;

    const timer = window.setTimeout(() => {
      target.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [currentUnlockTarget]);

  useEffect(() => {
    const wasAllRequiredInputsConfirmed =
      wasAllRequiredInputsConfirmedRef.current;
    wasAllRequiredInputsConfirmedRef.current = allRequiredInputsConfirmed;

    if (wasAllRequiredInputsConfirmed || !allRequiredInputsConfirmed) return;

    const timer = window.setTimeout(() => {
      onRequestWeatherConfirmation();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [allRequiredInputsConfirmed, onRequestWeatherConfirmation]);

  const isFieldEnabled = (hour: ForecastHourKey, field: InputField) => {
    if (!isHourAtOrAfter(hour, startForecastHour)) return false;
    const index = fieldOrder.findIndex(
      (item: { hour: ForecastHourKey; field: InputField }) =>
        item.hour === hour && item.field === field,
    );
    if (index === -1) return false;
    return currentUnlockIndex === -1 || index <= currentUnlockIndex;
  };

  const getDisplayedTemperature = (hour: ForecastHourKey): number => {
    const current = sessionDraft.weather.hourlyForecasts[hour].tempC;
    if (
      !isFixedTimeMode ||
      preferRestoredDraftTemperatures ||
      temperatureInputTouched[hour]
    ) {
      return current;
    }

    return fixedTimeTemperatures[hour] ?? current;
  };

  const applyHourlyChange = (
    hour: ForecastHourKey,
    field: InputField,
    patch: Partial<SessionDraft["weather"]["hourlyForecasts"][ForecastHourKey]>,
    shouldConfirm = true,
  ) => {
    const nextHourlyForecasts = cloneHourlyForecasts(
      sessionDraft.weather.hourlyForecasts,
    );
    nextHourlyForecasts[hour] = {
      ...nextHourlyForecasts[hour],
      ...patch,
    };

    const fieldInputHours = getInputHoursForField(activeHours, field);
    const activeIndex = fieldInputHours.indexOf(hour);
    const nextHour =
      activeIndex >= 0 ? fieldInputHours[activeIndex + 1] : undefined;
    if (nextHour && !confirmedInputs[nextHour][field]) {
      const currentEntry = nextHourlyForecasts[hour];
      nextHourlyForecasts[nextHour] = {
        ...nextHourlyForecasts[nextHour],
        ...(field === "weather" ? { weather: currentEntry.weather } : {}),
        ...(field === "temp" ? { tempC: currentEntry.tempC } : {}),
        ...(field === "wind" ? { windMs: currentEntry.windMs } : {}),
      };
    }

    if (shouldConfirm) {
      setConfirmedInputs((current) => ({
        ...current,
        [hour]: {
          ...current[hour],
          [field]: true,
        },
      }));
    }

    onChangeSessionDraft({
      ...(!sessionDraft.manualDiscountTimeOverride && !isFinalTime
        ? { weatherInputLockedDiscountTime: sessionDraft.discountTime }
        : {}),
      weather: {
        ...sessionDraft.weather,
        hourlyForecasts: nextHourlyForecasts,
      },
    });
  };

  const confirmCurrentDefault = (hour: ForecastHourKey, field: InputField) => {
    applyHourlyChange(hour, field, {}, true);
  };

  const changeTemperature = (hour: ForecastHourKey, tempC: number) => {
    setTemperatureInputTouched((current) => ({
      ...current,
      [hour]: true,
    }));
    applyHourlyChange(hour, "temp", { tempC }, false);
  };

  const confirmTemperature = (hour: ForecastHourKey) => {
    const tempC = getDisplayedTemperature(hour);
    setTemperatureInputTouched((current) => ({
      ...current,
      [hour]: true,
    }));
    applyHourlyChange(hour, "temp", { tempC }, true);

    if (isFixedTimeMode) {
      saveFixedTimeTemperature({
        enabled: true,
        date: sessionDraft.date,
        hour,
        tempC,
      });
      setFixedTimeTemperatures((current) => ({
        ...current,
        [hour]: tempC,
      }));
    }
  };

  const confirmWeatherInput = () => {
    if (isFixedTimeMode) {
      const values = activeHours.reduce((result, hour) => {
        result[hour] = sessionDraft.weather.hourlyForecasts[hour].tempC;
        return result;
      }, {} as Partial<Record<ForecastHourKey, number>>);

      saveFixedTimeTemperatures({
        enabled: true,
        date: sessionDraft.date,
        values,
      });
    }

    onStart();
  };

  const handleWeekdayWheel = (deltaY: number) => {
    const step = getWheelStep(deltaY);
    const currentIndex = WEEKDAY_OPTIONS.findIndex(
      (option) => option.value === sessionDraft.weekday,
    );
    const nextIndex = cycleIndex(WEEKDAY_OPTIONS.length, currentIndex, step);
    const nextWeekday = WEEKDAY_OPTIONS[nextIndex].value;

    onChangeSessionDraft({
      weekday: nextWeekday,
      manualWeekdayOverride: true,
    });
  };

  const handleDiscountTimeWheel = (deltaY: number) => {
    const step = getWheelStep(deltaY);
    const currentIndex = discountTimeOptions.findIndex(
      (option) => option.value === sessionDraft.discountTime,
    );
    const nextIndex = cycleIndex(
      discountTimeOptions.length,
      currentIndex,
      step,
    );
    const nextDiscountTime = discountTimeOptions[nextIndex].value;

    onChangeSessionDraft({
      discountTime: nextDiscountTime,
      manualDiscountTimeOverride: true,
    });
  };

  if (weatherConfirmationPending) {
    return (
      <WeatherConfirmationPanel
        rows={weatherConfirmationRows}
        onEdit={onEditWeatherInput}
        onConfirm={confirmWeatherInput}
      />
    );
  }

  const handleDemandCycleChange = () => {
    if (!canChangeDemandCycle) {
      window.alert(
        demandCycleChangeBlockedReason ??
          "当日の値引運用がすでに始まっているため、夏季モードを変更できません。",
      );
      return;
    }

    const nextDemandCycle: DemandCycle =
      demandCycle === "summer" ? "normal" : "summer";
    const confirmed = window.confirm(
      nextDemandCycle === "summer"
        ? "夏季モードをONにします。\n今年の夏季モードの同条件データが3件溜まるまでは手動判定になります。"
        : "夏季モードをOFFにします。\n保存済みの通常履歴を再利用します。",
    );
    if (!confirmed) return;
    onChangeDemandCycle(nextDemandCycle);
  };

  return (
    <main style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
      <ScreenHeader
        weekdayText=""
        timeText=""
        areaName={null}
        titleFontSize={16}
        titleContent={
          <>
            <div style={{ fontWeight: 700 }}>値引ヘルパー</div>
            <div style={{ fontSize: 13, fontWeight: 400 }}>
              （アプリ「ウェザーニュース」を見て入力）
            </div>
          </>
        }
        rightAction={
          onOpenSettings ? (
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="設定を開く"
              title="設定"
              style={{
                width: 48,
                height: 48,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 14,
                border: "1px solid #cbd5e1",
                background: "#fff",
                color: "#111",
                cursor: "pointer",
              }}
            >
              <svg
                aria-hidden="true"
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.14.37.35.7.6 1 .3.33.7.5 1.1.5H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.5Z" />
              </svg>
            </button>
          ) : null
        }
      />

      {summerModeAvailable ? (
      <section
        aria-label="夏季モード"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 14,
          padding: "10px 12px",
          border: "1px solid #cbd5e1",
          borderRadius: 12,
          background: demandCycle === "summer" ? "#fff7ed" : "#f8fafc",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 900 }}>
            夏季モード：{demandCycle === "summer" ? "ON" : "OFF"}
          </div>
          {!canChangeDemandCycle && demandCycleChangeBlockedReason ? (
            <div style={{ marginTop: 3, color: "#64748b", fontSize: 11, lineHeight: 1.35 }}>
              本日の運用開始後は変更できません
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={handleDemandCycleChange}
          style={{
            flexShrink: 0,
            minHeight: 44,
            padding: "8px 16px",
            borderRadius: 10,
            border: "1px solid #94a3b8",
            background: "#fff",
            color: "#0f172a",
            fontSize: 14,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          変更
        </button>
      </section>
      ) : null}

      <div style={{ marginBottom: 14 }}>
        <StartSectionLabel>曜日</StartSectionLabel>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}
        >
          <div
            onWheel={(e) => {
              e.preventDefault();
              handleWeekdayWheel(e.deltaY);
            }}
            style={{ minWidth: 0 }}
          >
            {sessionDraft.manualWeekdayOverride ? (
              <select
                value={sessionDraft.weekday}
                onChange={(e) =>
                  onChangeSessionDraft({
                    weekday: Number(e.target.value),
                    manualWeekdayOverride: true,
                  })
                }
                style={{
                  width: "100%",
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid #ccc",
                }}
              >
                {WEEKDAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <div
                style={{
                  width: "100%",
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid #ccc",
                  background: "#f7f7f7",
                  fontWeight: 700,
                }}
              >
                {getWeekdayLabel(sessionDraft.weekday)}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              if (sessionDraft.manualWeekdayOverride) {
                onChangeSessionDraft({
                  date: formatLocalDate(now),
                  weekday: now.getDay(),
                  manualWeekdayOverride: false,
                });
              } else {
                onChangeSessionDraft({ manualWeekdayOverride: true });
              }
            }}
            style={{
              padding: "0 14px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {sessionDraft.manualWeekdayOverride
              ? "自動に戻す"
              : "手動で切り替える"}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <StartSectionLabel>時刻</StartSectionLabel>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}
        >
          <div
            onWheel={(e) => {
              e.preventDefault();
              handleDiscountTimeWheel(e.deltaY);
            }}
            style={{ minWidth: 0 }}
          >
            {sessionDraft.manualDiscountTimeOverride ? (
              <select
                value={sessionDraft.discountTime}
                onChange={(e) =>
                  onChangeSessionDraft({
                    discountTime: e.target.value as DiscountTime,
                    manualDiscountTimeOverride: true,
                  })
                }
                style={{
                  width: "100%",
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid #ccc",
                }}
              >
                {discountTimeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <div
                style={{
                  width: "100%",
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid #ccc",
                  background: "#f7f7f7",
                  fontWeight: 700,
                }}
              >
                {getDiscountTimeLabel(sessionDraft.discountTime)}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              if (sessionDraft.manualDiscountTimeOverride) {
                onChangeSessionDraft({
                  discountTime: resolveDiscountTime(now),
                  manualDiscountTimeOverride: false,
                });
              } else {
                onChangeSessionDraft({ manualDiscountTimeOverride: true });
              }
            }}
            style={{
              padding: "0 14px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {sessionDraft.manualDiscountTimeOverride
              ? "自動に戻す"
              : "手動で切り替える"}
          </button>
        </div>
      </div>

      <>
          <StartSectionLabel>天候</StartSectionLabel>
          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 14,
              marginBottom: 16,
              background: "#fafafa",
            }}
          >
            <div style={{ overflowX: "auto", paddingBottom: 4 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${displayHours.length}, minmax(72px, 1fr))`,
                  gap: 8,
                  minWidth: displayHours.length * 78,
                  alignItems: "center",
                }}
              >
                {displayHours.map((hour) => (
                  <div
                    key={`head-${hour}`}
                    style={{ textAlign: "center", fontWeight: 800 }}
                  >
                    {hour}時
                  </div>
                ))}

                {displayHours.map((hour) => {
                  const forecast = sessionDraft.weather.hourlyForecasts[hour];
                  const enabled = isFieldEnabled(hour, "weather");
                  const isConfirmed = confirmedInputs[hour].weather;
                  return (
                    <div
                      key={`weather-wrap-${hour}`}
                      ref={(node) => {
                        hourlyFieldRefs.current[`weather-${hour}`] = node;
                      }}
                    >
                      <ForecastWeatherStepper
                        key={`weather-${hour}`}
                        weather={forecast.weather}
                        disabled={!enabled}
                        isUnconfirmed={!isConfirmed}
                        onConfirmCurrent={() =>
                          confirmCurrentDefault(hour, "weather")
                        }
                        onChange={(next) =>
                          applyHourlyChange(
                            hour,
                            "weather",
                            { weather: next },
                            false,
                          )
                        }
                      />
                    </div>
                  );
                })}

                {displayHours.map((hour) => {
                  const enabled = isFieldEnabled(hour, "temp");
                  const isConfirmed = confirmedInputs[hour].temp;
                  return (
                    <div
                      key={`temp-wrap-${hour}`}
                      ref={(node) => {
                        hourlyFieldRefs.current[`temp-${hour}`] = node;
                      }}
                    >
                      <ForecastNumberStepper
                        key={`temp-${hour}`}
                        value={getDisplayedTemperature(hour)}
                        options={TEMP_NUMBER_OPTIONS}
                        unit="℃"
                        disabled={!enabled}
                        isUnconfirmed={!isConfirmed}
                        onConfirmCurrent={() =>
                          confirmTemperature(hour)
                        }
                        onChange={(next) =>
                          changeTemperature(hour, next)
                        }
                      />
                    </div>
                  );
                })}

                {displayHours.map((hour) => {
                  const forecast = sessionDraft.weather.hourlyForecasts[hour];
                  const enabled = isFieldEnabled(hour, "wind");
                  const isConfirmed = confirmedInputs[hour].wind;
                  return (
                    <div
                      key={`wind-wrap-${hour}`}
                      ref={(node) => {
                        hourlyFieldRefs.current[`wind-${hour}`] = node;
                      }}
                    >
                      <ForecastNumberStepper
                        key={`wind-${hour}`}
                        value={forecast.windMs}
                        options={WIND_NUMBER_OPTIONS}
                        unit="m"
                        disabled={!enabled}
                        isUnconfirmed={!isConfirmed}
                        onConfirmCurrent={() =>
                          confirmCurrentDefault(hour, "wind")
                        }
                        onChange={(next) =>
                          applyHourlyChange(
                            hour,
                            "wind",
                            { windMs: next },
                            false,
                          )
                        }
                      />
                    </div>
                  );
                })}

                {displayHours.map((hour) => (
                  <div
                    key={`foot-${hour}`}
                    style={{
                      textAlign: "center",
                      fontWeight: 800,
                      paddingTop: 2,
                    }}
                  >
                    {hour}時
                  </div>
                ))}
              </div>
            </div>
          </section>
      </>

      {startButtonLabel === "再開" ? (
        <div style={{ fontSize: 13, color: "#666", marginBottom: 10 }}>
          条件を見直した内容で元の流れに戻ります。
        </div>
      ) : null}

      <PrimaryButton
        buttonRef={startButtonRef}
        onClick={onRequestWeatherConfirmation}
        disabled={!allRequiredInputsConfirmed}
      >
        入力内容を確認
      </PrimaryButton>


      {onReturnHome ? (
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            onClick={onReturnHome}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #ccc",
              background: "#fff",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            トップに戻る
          </button>
        </div>
      ) : null}

      {canStartReview19 && onStartReview19 ? (
        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          <button
            type="button"
            onClick={onStartReview19}
            style={{
              width: "100%",
              border: "1px solid #111",
              borderRadius: 14,
              padding: "14px 16px",
              background: "#fff",
              color: "#111",
              fontSize: 16,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            19:00チェックを始める
          </button>
        </div>
      ) : null}

      {previousDayDiscardTarget && onSavePreviousDayDiscardCount ? (
        <section style={{ marginTop: 16, width: "100%", minWidth: 0 }}>
          <button
            type="button"
            onClick={() => setDiscardPanelOpen((current) => !current)}
            aria-expanded={discardPanelOpen}
            style={{
              width: "100%",
              minHeight: 44,
              border: "1px solid #999",
              borderRadius: 12,
              padding: "10px 14px",
              background: "#fff",
              fontSize: 15,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            廃棄個数を入力
          </button>
          {discardPanelOpen ? (
            <div
              style={{
                marginTop: 8,
                padding: 12,
                border: "1px solid #ddd",
                borderRadius: 12,
                background: "#fafafa",
              }}
            >
              <div style={{ marginBottom: 8, fontWeight: 900 }}>
                対象日：{previousDayDiscardTarget.date}
              </div>
              <label htmlFor="previous-day-discard-count" style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 800 }}>
                廃棄個数（空欄可）
              </label>
              <input
                id="previous-day-discard-count"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={discardCountText}
                onChange={(event) => {
                  setDiscardCountText(event.currentTarget.value.replace(/[^0-9]/g, ""));
                  setDiscardMessage(null);
                }}
                placeholder="空欄"
                style={{
                  width: "100%",
                  minWidth: 0,
                  minHeight: 44,
                  boxSizing: "border-box",
                  border: "1px solid #bbb",
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 18,
                  fontWeight: 800,
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const count = discardCountText === "" ? null : Number(discardCountText);
                  if (count !== null && (!Number.isSafeInteger(count) || count < 0)) {
                    setDiscardMessage("0以上の整数で入力してください。");
                    return;
                  }
                  onSavePreviousDayDiscardCount(count);
                  setDiscardMessage("保存しました。");
                }}
                style={{
                  width: "100%",
                  minHeight: 44,
                  marginTop: 10,
                  border: 0,
                  borderRadius: 10,
                  background: "#111",
                  color: "#fff",
                  fontSize: 15,
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                保存
              </button>
              {discardMessage ? (
                <div role="status" style={{ marginTop: 8, fontSize: 13, fontWeight: 800 }}>
                  {discardMessage}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
