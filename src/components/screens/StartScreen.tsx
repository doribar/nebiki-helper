import { useEffect, useRef, useState } from "react";
import type {
  DiscountTime,
  ForecastHourKey,
  ForecastWeatherKind,
  SessionDraft,
} from "../../domain/types";
import {
  cloneHourlyForecasts,
  cycleForecastWeather,
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

function ForecastNumberSelect(props: {
  value: number;
  options: number[];
  unit: string;
  onChange: (next: number) => void;
  disabled?: boolean;
  isBlank?: boolean;
}) {
  return (
    <select
      value={props.isBlank ? "" : String(props.value)}
      onChange={(e) => props.onChange(Number(e.target.value))}
      disabled={props.disabled}
      style={{
        width: "100%",
        padding: "8px 6px",
        borderRadius: 8,
        border: "1px solid #ccc",
        background: props.disabled ? "#f0f0f0" : "#fff",
        color: props.disabled ? "#999" : "#000",
        fontWeight: 700,
        cursor: props.disabled ? "not-allowed" : "pointer",
      }}
    >
      {props.isBlank ? (
        <option value="" disabled>
          未入力
        </option>
      ) : null}
      {props.options.map((option) => (
        <option key={option} value={String(option)}>
          {option}{props.unit}
        </option>
      ))}
    </select>
  );
}

function ForecastNumberStepper(props: {
  value: number;
  options: number[];
  unit: string;
  onChange: (next: number) => void;
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

      <div
        style={{
          minHeight: 34,
          borderRadius: 8,
          border: "1px solid #ccc",
          background: props.disabled ? "#f0f0f0" : "#fff",
          color: props.disabled ? "#999" : "#000",
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "4px",
        }}
      >
        {props.value}{props.unit}
      </div>

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

function ForecastWeatherButton(props: {
  weather: ForecastWeatherKind;
  onClick: () => void;
  disabled?: boolean;
  isBlank?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        width: "100%",
        padding: "8px 6px",
        borderRadius: 10,
        border: "1px solid #ccc",
        background: props.disabled ? "#f0f0f0" : "#fff",
        color: props.disabled ? "#999" : "#000",
        cursor: props.disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        fontWeight: 700,
      }}
      title="タップで 晴れ→雨→雪 を切り替え"
    >
      {props.isBlank ? (
        <span style={{ fontSize: 12 }}>未入力</span>
      ) : (
        <>
          <span style={{ fontSize: 18, lineHeight: 1 }}>{getForecastWeatherSymbol(props.weather)}</span>
          <span style={{ fontSize: 12 }}>{getForecastWeatherLabel(props.weather)}</span>
        </>
      )}
    </button>
  );
}



function cloneForecastEntry(entry: SessionDraft["weather"]["hourlyForecasts"][ForecastHourKey]) {
  return { ...entry };
}

function isHourlyUnlockReady(touched: { weather: boolean; temp: boolean; wind: boolean }) {
  return touched.weather && touched.temp && touched.wind;
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
  const isFifteenInput = sessionDraft.discountTime === "15";
  const [touchedFifteen, setTouchedFifteen] = useState({
    weather: false,
    temp: false,
    wind: false,
  });
  const [blankFifteen, setBlankFifteen] = useState({
    weather: false,
    temp: false,
    wind: false,
  });
  const hasAppliedFifteenDefaultsRef = useRef(false);

  useEffect(() => {
    if (!isFifteenInput) {
      setTouchedFifteen({ weather: false, temp: false, wind: false });
      setBlankFifteen({ weather: false, temp: false, wind: false });
      hasAppliedFifteenDefaultsRef.current = false;
      return;
    }

    hasAppliedFifteenDefaultsRef.current = false;
    setTouchedFifteen({ weather: false, temp: false, wind: false });
    setBlankFifteen({ weather: true, temp: true, wind: true });
  }, [sessionDraft.discountTime, sessionDraft.date]);

  useEffect(() => {
    if (!isFifteenInput) return;
    if (hasAppliedFifteenDefaultsRef.current) return;
    if (!isHourlyUnlockReady(touchedFifteen)) return;

    const nextHourlyForecasts = cloneHourlyForecasts(sessionDraft.weather.hourlyForecasts);
    const baseForecast = cloneForecastEntry(nextHourlyForecasts["15"]);

    for (const hour of DISPLAY_FORECAST_HOURS) {
      if (hour === "15") continue;
      nextHourlyForecasts[hour] = cloneForecastEntry(baseForecast);
    }

    hasAppliedFifteenDefaultsRef.current = true;

    onChangeSessionDraft({
      weather: {
        ...sessionDraft.weather,
        hourlyForecasts: nextHourlyForecasts,
      },
    });
  }, [isFifteenInput, onChangeSessionDraft, sessionDraft.weather, touchedFifteen]);

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

  const updateHourlyCell = (
    hour: ForecastHourKey,
    patch: Partial<SessionDraft["weather"]["hourlyForecasts"][ForecastHourKey]>,
    source?: "weather" | "temp" | "wind",
  ) => {
    const nextHourlyForecasts = cloneHourlyForecasts(sessionDraft.weather.hourlyForecasts);
    nextHourlyForecasts[hour] = {
      ...nextHourlyForecasts[hour],
      ...patch,
    };

    if (isFifteenInput && hour === "15" && source) {
      setTouchedFifteen((current) => ({
        ...current,
        [source]: true,
      }));
      setBlankFifteen((current) => ({
        ...current,
        [source]: false,
      }));
    }

    onChangeSessionDraft({
      weather: {
        ...sessionDraft.weather,
        hourlyForecasts: nextHourlyForecasts,
      },
    });
  };

  const hourlyInputsUnlocked = !isFifteenInput || isHourlyUnlockReady(touchedFifteen);

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

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
          background: "#fafafa",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 8 }}>時間別お天気入力</div>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 12, lineHeight: 1.6 }}>
          15〜21時の予報を、ウェザーニュースの1時間ごと表示に合わせて入力します。15時のときは、最初に15時の天気・気温・風を選ぶと、その内容が16〜21時の初期値に入ります。
        </div>

        {isFifteenInput && !hourlyInputsUnlocked ? (
          <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
            まず15時の「天気・気温・風」を選ぶと、16〜21時も入力できるようになります。
          </div>
        ) : null}

        <div style={{ overflowX: "auto", paddingBottom: 4 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `72px repeat(${DISPLAY_FORECAST_HOURS.length}, minmax(72px, 1fr))`,
              gap: 8,
              minWidth: 72 + DISPLAY_FORECAST_HOURS.length * 78,
              alignItems: "center",
            }}
          >
            <div />
            {DISPLAY_FORECAST_HOURS.map((hour) => (
              <div key={`head-${hour}`} style={{ textAlign: "center", fontWeight: 800 }}>
                {hour}時
              </div>
            ))}

            <div style={{ fontWeight: 700 }}>天気</div>
            {DISPLAY_FORECAST_HOURS.map((hour) => {
              const forecast = sessionDraft.weather.hourlyForecasts[hour];
              return (
                <ForecastWeatherButton
                  key={`weather-${hour}`}
                  weather={forecast.weather}
                  isBlank={isFifteenInput && hour === "15" && blankFifteen.weather}
                  disabled={isFifteenInput && hour !== "15" && !hourlyInputsUnlocked}
                  onClick={() => {
                    const nextWeather = isFifteenInput && hour === "15" && blankFifteen.weather
                      ? "sunny"
                      : cycleForecastWeather(forecast.weather);
                    updateHourlyCell(hour, { weather: nextWeather }, "weather");
                  }}
                />
              );
            })}

            <div style={{ fontWeight: 700 }}>気温</div>
            {DISPLAY_FORECAST_HOURS.map((hour) => {
              const forecast = sessionDraft.weather.hourlyForecasts[hour];
              const locked = isFifteenInput && hour !== "15" && !hourlyInputsUnlocked;
              return (
                <div key={`temp-wrap-${hour}`}>
                  {hour === "15" ? (
                    <ForecastNumberSelect
                      key={`temp-${hour}`}
                      value={forecast.tempC}
                      options={TEMP_NUMBER_OPTIONS}
                      unit="℃"
                      isBlank={isFifteenInput && hour === "15" && blankFifteen.temp}
                      disabled={locked}
                      onChange={(next) => updateHourlyCell(hour, { tempC: next }, "temp")}
                    />
                  ) : (
                    <ForecastNumberStepper
                      key={`temp-${hour}`}
                      value={forecast.tempC}
                      options={TEMP_NUMBER_OPTIONS}
                      unit="℃"
                      disabled={locked}
                      onChange={(next) => updateHourlyCell(hour, { tempC: next }, "temp")}
                    />
                  )}
                </div>
              );
            })}

            <div style={{ fontWeight: 700 }}>風</div>
            {DISPLAY_FORECAST_HOURS.map((hour) => {
              const forecast = sessionDraft.weather.hourlyForecasts[hour];
              const locked = isFifteenInput && hour !== "15" && !hourlyInputsUnlocked;
              return (
                <div key={`wind-wrap-${hour}`}>
                  {hour === "15" ? (
                    <ForecastNumberSelect
                      key={`wind-${hour}`}
                      value={forecast.windMs}
                      options={WIND_NUMBER_OPTIONS}
                      unit="m"
                      isBlank={isFifteenInput && hour === "15" && blankFifteen.wind}
                      disabled={locked}
                      onChange={(next) => updateHourlyCell(hour, { windMs: next }, "wind")}
                    />
                  ) : (
                    <ForecastNumberStepper
                      key={`wind-${hour}`}
                      value={forecast.windMs}
                      options={WIND_NUMBER_OPTIONS}
                      unit="m"
                      disabled={locked}
                      onChange={(next) => updateHourlyCell(hour, { windMs: next }, "wind")}
                    />
                  )}
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

      <PrimaryButton onClick={onStart}>
        {startButtonLabel ?? (isFinalTime ? "最終値引へ進む" : "弁当・麺類から開始")}
      </PrimaryButton>
    </main>
  );
}
