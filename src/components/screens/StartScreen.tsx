import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DiscountTime,
  ForecastHourKey,
  ForecastWeatherKind,
  SessionDraft,
} from "../../domain/types";
import {
  cloneHourlyForecasts,
  FORECAST_HOUR_KEYS,
  getForecastWeatherLabel,
  getForecastWeatherSymbol,
} from "../../domain/hourlyWeather";
import { ScreenHeader } from "../layout/ScreenHeader";
import { PrimaryButton } from "../layout/PrimaryButton";

type StartScreenProps = {
  sessionDraft: SessionDraft;
  weatherGuideText: {
    nearTermWeatherGuide: string;
    laterPrecipGuide: string;
    laterPrecipTypeGuide: string;
    windGuide: string;
    tempGuide: string;
  };
  showAfterRainRecoverySelector: boolean;
  onChangeSessionDraft: (patch: Partial<SessionDraft>) => void;
  onStart: () => void;
  startButtonLabel?: string;
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

const AFTER_RAIN_OPTIONS = [
  { value: "cloudy", label: "くもり" },
  { value: "sunny", label: "晴れ" },
] as const;

const TEMP_NUMBER_OPTIONS = Array.from({ length: 46 }, (_, index) => index - 5);
const WIND_NUMBER_OPTIONS = Array.from({ length: 16 }, (_, index) => index);
const DISPLAY_FORECAST_HOURS: ForecastHourKey[] = FORECAST_HOUR_KEYS;
const FORECAST_WEATHER_ORDER: ForecastWeatherKind[] = ["sunny", "rain", "snow"];

function stepForecastWeather(current: ForecastWeatherKind, delta: 1 | -1): ForecastWeatherKind {
  const currentIndex = FORECAST_WEATHER_ORDER.indexOf(current);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + delta + FORECAST_WEATHER_ORDER.length) % FORECAST_WEATHER_ORDER.length;
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

  if (minutes < 16 * 60 + 30) return "15";
  if (minutes < 18 * 60 + 30) return "17";
  if (minutes < 19 * 60 + 30) return "18";
  if (minutes < 20 * 60 + 30) return "19";
  return "20";
}

function getWeekdayLabel(weekday: number): string {
  const map = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
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

function cycleIndex(length: number, currentIndex: number, delta: number): number {
  return (currentIndex + delta + length) % length;
}

function getWheelStep(deltaY: number): 1 | -1 {
  return deltaY > 0 ? 1 : -1;
}

type SegmentedProps<T extends string> = {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  columns?: number;
  helperText?: string;
};

function SegmentedSelector<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = options.length,
  helperText,
}: SegmentedProps<T>) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{label}</div>
      {helperText ? (
        <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>{helperText}</div>
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: 8,
        }}
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              style={{
                padding: "12px 10px",
                borderRadius: 12,
                border: active ? "2px solid #1976d2" : "1px solid #ccc",
                background: active ? "#e3f2fd" : "#fff",
                fontWeight: active ? 800 : 600,
                cursor: "pointer",
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
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
          if (props.disabled || !props.isUnconfirmed || !props.onConfirmCurrent) return;
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
          cursor: props.disabled ? "not-allowed" : props.isUnconfirmed ? "pointer" : "default",
        }}
      >
        {props.value}{props.unit}
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
          if (props.disabled || !props.isUnconfirmed || !props.onConfirmCurrent) return;
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
          cursor: props.disabled ? "not-allowed" : props.isUnconfirmed ? "pointer" : "default",
          gap: 2,
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>{getForecastWeatherSymbol(props.weather)}</span>
        <span style={{ fontSize: 12 }}>{getForecastWeatherLabel(props.weather)}</span>
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
type ForecastConfirmationMap = Record<ForecastHourKey, Record<InputField, boolean>>;

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

function getInputStartForecastHour(discountTime: DiscountTime): ForecastHourKey {
  switch (discountTime) {
    case "15":
      return "15";
    case "17":
      return "18";
    case "18":
      return "19";
    case "19":
      return "20";
    case "20":
      return "21";
  }
}

function getInputHoursForField(activeHours: ForecastHourKey[], field: InputField): ForecastHourKey[] {
  return field === "temp" ? [...activeHours].reverse() : activeHours;
}

function createFieldOrder(startHour: ForecastHourKey) {
  const activeHours = DISPLAY_FORECAST_HOURS.filter((hour) => isHourAtOrAfter(hour, startHour));
  return INPUT_FIELDS.flatMap((field) =>
    getInputHoursForField(activeHours, field).map((hour) => ({ hour, field }))
  );
}

export function StartScreen({
  sessionDraft,
  weatherGuideText: _weatherGuideText,
  showAfterRainRecoverySelector,
  onChangeSessionDraft,
  onStart,
  startButtonLabel,
}: StartScreenProps) {
  const isFinalTime = sessionDraft.discountTime === "20";
  const startForecastHour = getInputStartForecastHour(sessionDraft.discountTime);
  const activeHours = useMemo(
    () => DISPLAY_FORECAST_HOURS.filter((hour) => isHourAtOrAfter(hour, startForecastHour)),
    [startForecastHour]
  );
  const fieldOrder = useMemo(() => createFieldOrder(startForecastHour), [startForecastHour]);
  const [confirmedInputs, setConfirmedInputs] = useState<ForecastConfirmationMap>(createEmptyConfirmationMap());
  const hourlyFieldRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    setConfirmedInputs(createEmptyConfirmationMap());
  }, [sessionDraft.discountTime, sessionDraft.date]);

  const currentUnlockIndex = isFinalTime
    ? -1
    : fieldOrder.findIndex(({ hour, field }: { hour: ForecastHourKey; field: InputField }) => !confirmedInputs[hour][field]);
  const currentUnlockTarget = currentUnlockIndex >= 0 ? fieldOrder[currentUnlockIndex] : null;
  const allRequiredInputsConfirmed = isFinalTime || currentUnlockIndex === -1;


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

  const isFieldEnabled = (hour: ForecastHourKey, field: InputField) => {
    if (!isHourAtOrAfter(hour, startForecastHour)) return false;
    const index = fieldOrder.findIndex((item: { hour: ForecastHourKey; field: InputField }) => item.hour === hour && item.field === field);
    if (index === -1) return false;
    return currentUnlockIndex === -1 || index <= currentUnlockIndex;
  };

  const applyHourlyChange = (
    hour: ForecastHourKey,
    field: InputField,
    patch: Partial<SessionDraft["weather"]["hourlyForecasts"][ForecastHourKey]>,
    shouldConfirm = true,
  ) => {
    const nextHourlyForecasts = cloneHourlyForecasts(sessionDraft.weather.hourlyForecasts);
    nextHourlyForecasts[hour] = {
      ...nextHourlyForecasts[hour],
      ...patch,
    };

    const fieldInputHours = getInputHoursForField(activeHours, field);
    const activeIndex = fieldInputHours.indexOf(hour);
    const nextHour = activeIndex >= 0 ? fieldInputHours[activeIndex + 1] : undefined;
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
      weather: {
        ...sessionDraft.weather,
        hourlyForecasts: nextHourlyForecasts,
      },
    });
  };

  const confirmCurrentDefault = (hour: ForecastHourKey, field: InputField) => {
    applyHourlyChange(hour, field, {}, true);
  };

  const handleWeekdayWheel = (deltaY: number) => {
    const step = getWheelStep(deltaY);
    const currentIndex = WEEKDAY_OPTIONS.findIndex((option) => option.value === sessionDraft.weekday);
    const nextIndex = cycleIndex(WEEKDAY_OPTIONS.length, currentIndex, step);
    const nextWeekday = WEEKDAY_OPTIONS[nextIndex].value;

    onChangeSessionDraft({
      weekday: nextWeekday,
      manualWeekdayOverride: true,
    });
  };

  const handleDiscountTimeWheel = (deltaY: number) => {
    const step = getWheelStep(deltaY);
    const currentIndex = DISCOUNT_TIME_OPTIONS.findIndex((option) => option.value === sessionDraft.discountTime);
    const nextIndex = cycleIndex(DISCOUNT_TIME_OPTIONS.length, currentIndex, step);
    const nextDiscountTime = DISCOUNT_TIME_OPTIONS[nextIndex].value;

    onChangeSessionDraft({
      discountTime: nextDiscountTime,
      manualDiscountTimeOverride: true,
    });
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
      />

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>曜日</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
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
                style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #ccc" }}
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
                  date: formatLocalDate(new Date()),
                  weekday: new Date().getDay(),
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
            {sessionDraft.manualWeekdayOverride ? "自動に戻す" : "手動で切り替える"}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>時刻</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
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
                style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #ccc" }}
              >
                {DISCOUNT_TIME_OPTIONS.map((option) => (
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
                  discountTime: resolveDiscountTime(new Date()),
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
            {sessionDraft.manualDiscountTimeOverride ? "自動に戻す" : "手動で切り替える"}
          </button>
        </div>
      </div>

{!isFinalTime ? (
        <>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>天候</div>
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
              gridTemplateColumns: `repeat(${DISPLAY_FORECAST_HOURS.length}, minmax(72px, 1fr))`,
              gap: 8,
              minWidth: DISPLAY_FORECAST_HOURS.length * 78,
              alignItems: "center",
            }}
          >
            {DISPLAY_FORECAST_HOURS.map((hour) => (
              <div key={`head-${hour}`} style={{ textAlign: "center", fontWeight: 800 }}>
                {hour}時
              </div>
            ))}

            {DISPLAY_FORECAST_HOURS.map((hour) => {
              const forecast = sessionDraft.weather.hourlyForecasts[hour];
              const enabled = isFieldEnabled(hour, "weather");
              const isConfirmed = confirmedInputs[hour].weather;
              return (
                <div key={`weather-wrap-${hour}`} ref={(node) => { hourlyFieldRefs.current[`weather-${hour}`] = node; }}>
                  <ForecastWeatherStepper
                    key={`weather-${hour}`}
                    weather={forecast.weather}
                    disabled={!enabled}
                    isUnconfirmed={!isConfirmed}
                    onConfirmCurrent={() => confirmCurrentDefault(hour, "weather")}
                    onChange={(next) => applyHourlyChange(hour, "weather", { weather: next }, false)}
                  />
                </div>
              );
            })}

            {DISPLAY_FORECAST_HOURS.map((hour) => {
              const forecast = sessionDraft.weather.hourlyForecasts[hour];
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
                    value={forecast.tempC}
                    options={TEMP_NUMBER_OPTIONS}
                    unit="℃"
                    disabled={!enabled}
                    isUnconfirmed={!isConfirmed}
                    onConfirmCurrent={() => confirmCurrentDefault(hour, "temp")}
                    onChange={(next) => applyHourlyChange(hour, "temp", { tempC: next }, false)}
                  />
                </div>
              );
            })}

            {DISPLAY_FORECAST_HOURS.map((hour) => {
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
                    onConfirmCurrent={() => confirmCurrentDefault(hour, "wind")}
                    onChange={(next) => applyHourlyChange(hour, "wind", { windMs: next }, false)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {showAfterRainRecoverySelector ? (
        <SegmentedSelector
          label="雨上がり後"
          helperText="前回は近い雨あり、今回は近い雨なしのため選択"
          value={sessionDraft.weather.afterRainSky ?? "cloudy"}
          options={[...AFTER_RAIN_OPTIONS]}
          onChange={(next) =>
            onChangeSessionDraft({
              weather: {
                ...sessionDraft.weather,
                afterRainSky: next,
              },
            })
          }
          columns={2}
        />
      ) : null}
        </>
      ) : null}

      {isFinalTime ? (
        <section
          style={{
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
            background: "#fafafa",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 8 }}>20時30分以降は最終値引です</div>
          <div style={{ lineHeight: 1.7 }}>なるべく商品が多いエリアから値引きを始めてください。</div>
        </section>
      ) : null}

      {startButtonLabel === "再開" ? (
        <div style={{ fontSize: 13, color: "#666", marginBottom: 10 }}>
          条件を見直した内容で元の流れに戻ります。
        </div>
      ) : null}

      <PrimaryButton onClick={onStart} disabled={!allRequiredInputsConfirmed}>
        {startButtonLabel ?? (isFinalTime ? "最終値引へ進む" : "弁当・麺類から開始")}
      </PrimaryButton>
    </main>
  );
}
