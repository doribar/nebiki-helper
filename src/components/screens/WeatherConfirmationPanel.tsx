import { useRef } from "react";
import type { ForecastHourKey, SessionDraft } from "../../domain/types";
import {
  getForecastWeatherLabel,
  getForecastWeatherSymbol,
} from "../../domain/hourlyWeather";
import { PrimaryButton } from "../layout/PrimaryButton";
import { ScreenHeader } from "../layout/ScreenHeader";

type WeatherConfirmationPanelProps = {
  sessionDraft: SessionDraft;
  hours: ForecastHourKey[];
  onEdit: () => void;
  onConfirm: () => void;
};

export function WeatherConfirmationPanel({
  sessionDraft,
  hours,
  onEdit,
  onConfirm,
}: WeatherConfirmationPanelProps) {
  const submittedRef = useRef(false);

  const handleConfirm = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onConfirm();
  };

  const handleEdit = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onEdit();
  };

  return (
    <main
      style={{
        padding: 16,
        maxWidth: 560,
        margin: "0 auto",
        minWidth: 0,
        overflowX: "hidden",
      }}
    >
      <ScreenHeader
        weekdayText=""
        timeText=""
        areaName={null}
        titleFontSize={16}
        titleContent={<div style={{ fontWeight: 700 }}>値引ヘルパー</div>}
      />

      <section aria-labelledby="weather-confirmation-title">
        <h1
          id="weather-confirmation-title"
          style={{ fontSize: 21, lineHeight: 1.4, margin: "4px 0 14px" }}
        >
          入力した天候を確認してください
        </h1>

        <div
          role="list"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(3, hours.length)}, minmax(0, 1fr))`,
            gap: 8,
            width: "100%",
            minWidth: 0,
          }}
        >
          {hours.map((hour) => {
            const forecast = sessionDraft.weather.hourlyForecasts[hour];
            return (
              <article
                key={hour}
                role="listitem"
                style={{
                  minWidth: 0,
                  border: "1px solid #d7dce2",
                  borderRadius: 12,
                  padding: "10px 8px",
                  background: "#fafafa",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
                  {hour}時
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                    minWidth: 0,
                    marginBottom: 6,
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: 21, lineHeight: 1 }}>
                    {getForecastWeatherSymbol(forecast.weather)}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>
                    {getForecastWeatherLabel(forecast.weather)}
                  </span>
                </div>
                <div style={{ fontSize: 15, lineHeight: 1.6 }}>
                  {forecast.tempC}℃
                </div>
                <div style={{ fontSize: 15, lineHeight: 1.6 }}>
                  {forecast.windMs}m/s
                </div>
              </article>
            );
          })}
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
          <button
            type="button"
            onClick={handleEdit}
            style={{
              width: "100%",
              minHeight: 48,
              border: "1px solid #777",
              borderRadius: 12,
              padding: "11px 14px",
              background: "#fff",
              color: "#111",
              fontSize: 16,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            入力を修正
          </button>
          <PrimaryButton onClick={handleConfirm}>
            この内容で確定
          </PrimaryButton>
        </div>
      </section>
    </main>
  );
}
