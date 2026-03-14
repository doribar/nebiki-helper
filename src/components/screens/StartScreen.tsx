import type { DiscountTime, SessionDraft } from "../../domain/types";
import { ScreenHeader } from "../layout/ScreenHeader";
import { PrimaryButton } from "../layout/PrimaryButton";

type StartScreenProps = {
  sessionDraft: SessionDraft;
  weatherGuideText: {
    rainGuide: string;
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

const TIME_OPTIONS: { value: DiscountTime; label: string }[] = [
  { value: "17", label: "17時" },
  { value: "18", label: "18時" },
  { value: "19", label: "19時" },
  { value: "20", label: "20時" },
];

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
          Yes
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
          No
        </button>
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

  return (
    <main style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
      <ScreenHeader
        weekdayText="値引ヘルパー"
        timeText=""
        areaName={null}
      />

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 12 }}>今回の条件</div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>曜日</div>
          <select
            value={sessionDraft.weekday}
            onChange={(e) =>
              onChangeSessionDraft({ weekday: Number(e.target.value) })
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
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>値引開始時刻</div>
          <select
            value={sessionDraft.discountTime}
            onChange={(e) =>
              onChangeSessionDraft({
                discountTime: e.target.value as DiscountTime,
              })
            }
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 10,
              border: "1px solid #ccc",
            }}
          >
            {TIME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {!isFinalTime ? (
          <>
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 10,
                padding: 12,
                background: "#fafafa",
                marginBottom: 14,
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 6 }}>天候の確認方法</div>
              <div>雨：{weatherGuideText.rainGuide}</div>
              <div>風3m以上：{weatherGuideText.windGuide}</div>
              <div>気温10度以下：{weatherGuideText.tempGuide}</div>
            </div>

            <YesNoToggle
              label={`雨（${weatherGuideText.rainGuide}）`}
              value={sessionDraft.weather.isRain}
              onChange={(next) =>
                onChangeSessionDraft({
                  weather: { ...sessionDraft.weather, isRain: next },
                })
              }
            />

            <YesNoToggle
              label={`風3m以上（${weatherGuideText.windGuide}）`}
              value={sessionDraft.weather.isWindOver3m}
              onChange={(next) =>
                onChangeSessionDraft({
                  weather: { ...sessionDraft.weather, isWindOver3m: next },
                })
              }
            />

            <YesNoToggle
              label={`気温10度以下（${weatherGuideText.tempGuide}）`}
              value={sessionDraft.weather.isTempUnder10}
              onChange={(next) =>
                onChangeSessionDraft({
                  weather: { ...sessionDraft.weather, isTempUnder10: next },
                })
              }
            />
          </>
        ) : null}
      </section>

      {!isFinalTime ? (
        <section
          style={{
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div style={{ lineHeight: 1.7 }}>
            弁当エリアに向かいながら、売場全体に目を通してください。
            <br />
            この段階ではまだ値引しません。
            <br />
            全体の数や並びを大まかに頭に入れてください。
          </div>
        </section>
      ) : (
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
            20時は最終値引です
          </div>
          <div style={{ lineHeight: 1.7 }}>
            なるべく商品が多いエリアから値引きを始めてください。
          </div>
        </section>
      )}

      <PrimaryButton onClick={onStart}>
        {isFinalTime ? "20時の値引率表示へ進む" : "弁当・麺類から開始"}
      </PrimaryButton>
    </main>
  );
}