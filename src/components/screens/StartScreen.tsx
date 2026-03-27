import type {
  DiscountTime,
  LaterPrecipType,
  NearTermWeather,
  SessionDraft,
  TempLevel,
  WindLevel,
} from "../../domain/types";
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
  onChangeSessionDraft: (patch: Partial<SessionDraft>) => void;
  onStart: () => void;
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

const NEAR_TERM_WEATHER_OPTIONS: { value: NearTermWeather; label: string }[] = [
  { value: "other", label: "晴れ・くもり" },
  { value: "rain", label: "雨" },
  { value: "snow", label: "雪" },
];

const LATER_PRECIP_TYPE_OPTIONS: {
  value: Exclude<LaterPrecipType, null>;
  label: string;
}[] = [
  { value: "rain", label: "雨" },
  { value: "snow", label: "雪" },
];

const WIND_OPTIONS: { value: WindLevel; label: string }[] = [
  { value: "2orLess", label: "2m以下" },
  { value: "3to4", label: "3〜4m" },
  { value: "5orMore", label: "5m以上" },
];

const TEMP_OPTIONS: { value: TempLevel; label: string }[] = [
  { value: "10orLess", label: "10度以下" },
  { value: "11to15", label: "11〜15度" },
  { value: "16to25", label: "16〜25度" },
  { value: "26orMore", label: "26度以上" },
];

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

type ToggleProps = {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
};

function YesNoToggle({ label, value, onChange }: ToggleProps) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{label}</div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => onChange(true)}
          style={{
            flex: 1,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #ccc",
            background: value ? "#e8f0ff" : "#fff",
            cursor: "pointer",
          }}
        >
          ある
        </button>

        <button
          type="button"
          onClick={() => onChange(false)}
          style={{
            flex: 1,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #ccc",
            background: !value ? "#e8f0ff" : "#fff",
            cursor: "pointer",
          }}
        >
          ない
        </button>
      </div>
    </div>
  );
}

type SegmentedProps<T extends string> = {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
};

function SegmentedSelector<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{label}</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            style={{
              flex: 1,
              minWidth: 90,
              padding: 12,
              borderRadius: 10,
              border: "1px solid #ccc",
              background: value === option.value ? "#e8f0ff" : "#fff",
              cursor: "pointer",
              fontWeight: value === option.value ? 700 : 400,
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function StartScreen({
  sessionDraft,
  weatherGuideText,
  onChangeSessionDraft,
  onStart,
}: StartScreenProps) {
  const isFinalTime = sessionDraft.discountTime === "20";
  const laterPrecipTypeValue = sessionDraft.weather.laterPrecipType ?? "rain";

  return (
    <main style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
      <ScreenHeader
        weekdayText="値引ヘルパー"
        timeText=""
        areaName={null}
        titleFontSize={16}
      />

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>曜日</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
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
                onChangeSessionDraft({
                  manualWeekdayOverride: true,
                });
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
        <div style={{ fontWeight: 700, marginBottom: 8 }}>値引基準時刻</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
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

          <button
            type="button"
            onClick={() => {
              if (sessionDraft.manualDiscountTimeOverride) {
                onChangeSessionDraft({
                  discountTime: resolveDiscountTime(new Date()),
                  manualDiscountTimeOverride: false,
                });
              } else {
                onChangeSessionDraft({
                  manualDiscountTimeOverride: true,
                });
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

      <SegmentedSelector
        label={weatherGuideText.nearTermWeatherGuide}
        value={sessionDraft.weather.nearTermWeather}
        options={NEAR_TERM_WEATHER_OPTIONS}
        onChange={(next) => {
          if (next === "other") {
            onChangeSessionDraft({
              weather: {
                ...sessionDraft.weather,
                nearTermWeather: "other",
                hasLaterPrecip: false,
                laterPrecipType: null,
              },
            });
            return;
          }

          onChangeSessionDraft({
            weather: {
              ...sessionDraft.weather,
              nearTermWeather: next,
              hasLaterPrecip: true,
              laterPrecipType: next,
            },
          });
        }}
      />

      {sessionDraft.weather.nearTermWeather === "other" ? (
        <>
          <YesNoToggle
            label={weatherGuideText.laterPrecipGuide}
            value={sessionDraft.weather.hasLaterPrecip}
            onChange={(next) =>
              onChangeSessionDraft({
                weather: {
                  ...sessionDraft.weather,
                  hasLaterPrecip: next,
                  laterPrecipType: next
                    ? sessionDraft.weather.laterPrecipType ?? "rain"
                    : null,
                },
              })
            }
          />

          {sessionDraft.weather.hasLaterPrecip ? (
            <SegmentedSelector
              label={weatherGuideText.laterPrecipTypeGuide}
              value={laterPrecipTypeValue}
              options={LATER_PRECIP_TYPE_OPTIONS}
              onChange={(next) =>
                onChangeSessionDraft({
                  weather: {
                    ...sessionDraft.weather,
                    laterPrecipType: next,
                  },
                })
              }
            />
          ) : null}
        </>
      ) : null}

      <SegmentedSelector
        label={weatherGuideText.windGuide}
        value={sessionDraft.weather.windLevel}
        options={WIND_OPTIONS}
        onChange={(next) =>
          onChangeSessionDraft({
            weather: { ...sessionDraft.weather, windLevel: next },
          })
        }
      />

      <SegmentedSelector
        label={weatherGuideText.tempGuide}
        value={sessionDraft.weather.tempLevel}
        options={TEMP_OPTIONS}
        onChange={(next) =>
          onChangeSessionDraft({
            weather: { ...sessionDraft.weather, tempLevel: next },
          })
        }
      />

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
          <div style={{ fontWeight: 800, marginBottom: 8 }}>
            20時30分以降は最終値引です
          </div>
          <div style={{ lineHeight: 1.7 }}>
            なるべく商品が多いエリアから値引きを始めてください。
          </div>
        </section>
      ) : null}

      <PrimaryButton onClick={onStart}>
        {isFinalTime ? "最終値引へ進む" : "弁当・麺類から開始"}
      </PrimaryButton>
    </main>
  );
}