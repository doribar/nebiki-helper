import { useRef } from "react";
import type { WeatherConfirmationDisplayRow } from "../../domain/weatherConfirmationDisplay";
import {
  getForecastWeatherLabel,
  getForecastWeatherSymbol,
} from "../../domain/hourlyWeather";
import { PrimaryButton } from "../layout/PrimaryButton";
import { ScreenHeader } from "../layout/ScreenHeader";

type WeatherConfirmationPanelProps = {
  rows: WeatherConfirmationDisplayRow[];
  onEdit: () => void;
  onConfirm: () => void;
};

const rowHeaderStyle = {
  width: 52,
  padding: "7px 2px",
  background: "#f0f2f5",
  borderTop: "1px solid #dfe3e8",
  color: "#343a40",
  fontSize: 13,
  fontWeight: 800,
  lineHeight: 1.2,
  textAlign: "center" as const,
};

function getValueCellStyle(isPast: boolean) {
  return {
    minWidth: 0,
    padding: "7px 1px",
    borderTop: "1px solid #dfe3e8",
    borderLeft: "1px solid #e5e8ec",
    background: isPast ? "#eef0f2" : "#fafafa",
    color: isPast ? "#747b84" : "#111",
    textAlign: "center" as const,
    fontSize: 15,
    lineHeight: 1.25,
    fontVariantNumeric: "tabular-nums",
  };
}

export function WeatherConfirmationPanel({
  rows,
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
          style={{
            width: "100%",
            minWidth: 0,
            overflowX: "hidden",
            border: "1px solid #d7dce2",
            borderRadius: 12,
            background: "#fafafa",
          }}
        >
          <table
            aria-label="入力した天候の確認"
            style={{
              width: "100%",
              tableLayout: "fixed",
              borderCollapse: "collapse",
            }}
          >
            <colgroup>
              <col style={{ width: 52 }} />
              {rows.map((row) => (
                <col key={row.hour} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th
                  aria-label="項目"
                  style={{
                    padding: "7px 2px",
                    background: "#e9edf1",
                  }}
                />
                {rows.map((row) => (
                  <th
                    key={row.hour}
                    scope="col"
                    aria-label={`${row.hour}時${row.isPast ? "（過去）" : ""}`}
                    style={{
                      minWidth: 0,
                      padding: row.isPast ? "4px 1px" : "7px 1px",
                      borderLeft: "1px solid #dfe3e8",
                      background: row.isPast ? "#dfe3e7" : "#e9edf1",
                      color: row.isPast ? "#666d76" : "#111",
                      fontSize: 14,
                      fontWeight: 800,
                      lineHeight: 1.1,
                      textAlign: "center",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <span style={{ display: "block" }}>{row.hour}</span>
                    {row.isPast ? (
                      <span
                        style={{
                          display: "block",
                          marginTop: 2,
                          fontSize: 9,
                          fontWeight: 700,
                        }}
                      >
                        過去
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" style={rowHeaderStyle}>
                  天気
                </th>
                {rows.map((row) => (
                  <td key={row.hour} style={getValueCellStyle(row.isPast)}>
                    {row.weather ? (
                      <span
                        role="img"
                        aria-label={getForecastWeatherLabel(row.weather)}
                        style={{ fontSize: 21, lineHeight: 1 }}
                      >
                        {getForecastWeatherSymbol(row.weather)}
                      </span>
                    ) : (
                      "－"
                    )}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row" style={rowHeaderStyle}>
                  <span style={{ display: "block" }}>気温</span>
                  <span style={{ display: "block", marginTop: 2, fontSize: 10 }}>
                    ℃
                  </span>
                </th>
                {rows.map((row) => (
                  <td key={row.hour} style={getValueCellStyle(row.isPast)}>
                    {row.tempC ?? "－"}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row" style={rowHeaderStyle}>
                  <span style={{ display: "block" }}>風速</span>
                  <span style={{ display: "block", marginTop: 2, fontSize: 10 }}>
                    m/s
                  </span>
                </th>
                {rows.map((row) => (
                  <td key={row.hour} style={getValueCellStyle(row.isPast)}>
                    {row.windMs ?? "－"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
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
