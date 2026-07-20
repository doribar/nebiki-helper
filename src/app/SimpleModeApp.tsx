import { useEffect, useMemo } from "react";
import { getAreaName } from "../domain/area.ts";
import {
  getSimpleCalculation,
  getSimpleHolidayNotices,
  resolveSimpleDiscountTime,
} from "../domain/simpleMode.ts";
import { getWeatherGuideText } from "../domain/weekdayBase.ts";
import type { AreaCountEvaluation } from "../domain/types.ts";
import type { UseSimpleModeResult } from "../hooks/useSimpleMode.ts";
import {
  DayBeforeHolidayNotice,
  HolidayBeforeNormalWeekdayNotice,
  ThreeDayHolidayMiddleNotice,
} from "../components/common/DayBeforeHolidayNotice.ts";
import { WeekdayBasePanel } from "../components/common/WeekdayBasePanel.tsx";
import { PrimaryButton } from "../components/layout/PrimaryButton.tsx";
import { ScreenHeader } from "../components/layout/ScreenHeader.tsx";
import { StartScreen } from "../components/screens/StartScreen.tsx";

const EVALUATIONS: AreaCountEvaluation[] = [
  "many",
  "slightly_many",
  "normal",
  "slightly_few",
  "few",
];

function simpleEvaluationText(evaluation: AreaCountEvaluation): string {
  switch (evaluation) {
    case "many": return "多い";
    case "slightly_many": return "やや多い";
    case "normal": return "普通";
    case "slightly_few": return "やや少ない";
    case "few": return "少ない";
  }
}

const panelStyle = {
  border: "1px solid #ddd",
  borderRadius: 14,
  padding: 16,
  marginBottom: 16,
  background: "#fff",
} as const;

function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="設定を開く"
      title="設定"
      style={{
        width: 46,
        height: 46,
        borderRadius: 14,
        border: "1px solid #cbd5e1",
        background: "#fff",
        fontSize: 23,
        cursor: "pointer",
      }}
    >
      ⚙
    </button>
  );
}

function SimpleHeader(props: {
  title: string;
  areaName?: string | null;
  onOpenSettings: () => void;
}) {
  return (
    <>
      <ScreenHeader
        weekdayText=""
        timeText=""
        areaName={null}
        titleContent={
          <div style={{ textAlign: "left" }}>
            <div>{props.title}</div>
            <div style={{ marginTop: 2, fontSize: 12, color: "#64748b" }}>簡易モード</div>
          </div>
        }
        rightAction={<SettingsButton onClick={props.onOpenSettings} />}
      />
      {props.areaName ? (
        <h1 style={{ margin: "8px 0 18px", fontSize: 30, lineHeight: 1.25 }}>
          {props.areaName}
        </h1>
      ) : null}
    </>
  );
}

function BasisAndHoliday(props: {
  app: UseSimpleModeResult;
  evaluation?: AreaCountEvaluation;
  now: Date;
}) {
  const calculation = getSimpleCalculation({
    draft: props.app.state.sessionDraft,
    evaluation: props.evaluation ?? "normal",
    now: props.now,
  });
  const notices = getSimpleHolidayNotices(props.app.state.sessionDraft);
  return (
    <>
      <p style={{ margin: "0 0 12px", fontWeight: 800, lineHeight: 1.6 }}>
        {calculation.basisGuide.referenceText}、残り数を判断してください。
      </p>
      <DayBeforeHolidayNotice visible={notices.dayBefore} />
      <ThreeDayHolidayMiddleNotice visible={notices.threeDayMiddle} />
      <HolidayBeforeNormalWeekdayNotice visible={notices.holidayBeforeWeekday} />
      <WeekdayBasePanel
        noticeText={calculation.basisGuide.noticeText}
        weekdaySummaryText={calculation.basisGuide.weekdaySummaryText}
        weekdayDetailLines={calculation.basisGuide.weekdayDetailLines}
        bonusSummaryText={calculation.basisGuide.bonusSummaryText}
        bonusDetailLines={calculation.basisGuide.bonusDetailLines}
      />
    </>
  );
}

function JudgmentScreen(props: {
  app: UseSimpleModeResult;
  now: Date;
  onOpenSettings: () => void;
}) {
  const areaId = props.app.state.currentAreaId;
  if (!areaId) return null;
  return (
    <main style={{ padding: 16, maxWidth: 560, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <SimpleHeader title="エリアの残数判定" areaName={getAreaName(areaId)} onOpenSettings={props.onOpenSettings} />
      <BasisAndHoliday app={props.app} now={props.now} />
      <section style={panelStyle}>
        <p style={{ margin: "0 0 14px", fontWeight: 900 }}>
          このエリア全体の残り方を選んでください。
        </p>
        <div style={{ display: "grid", gap: 10 }}>
          {EVALUATIONS.map((evaluation) => (
            <button
              key={evaluation}
              type="button"
              onClick={() => props.app.actions.judgeCurrentArea(evaluation)}
              style={{
                minHeight: 54,
                borderRadius: 12,
                border: "2px solid #b42318",
                background: "#fff",
                color: "#7f1d1d",
                fontSize: 19,
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              {simpleEvaluationText(evaluation)}
            </button>
          ))}
        </div>
      </section>
      <p style={{ color: "#64748b", fontSize: 13 }}>
        {props.app.state.currentIndex + 1} / {props.app.route.length}
      </p>
    </main>
  );
}

function FirstLapScreen(props: {
  app: UseSimpleModeResult;
  now: Date;
  onOpenSettings: () => void;
}) {
  const areaId = props.app.state.currentAreaId;
  if (!areaId) return null;
  const evaluation = props.app.state.judgments[areaId] ?? "normal";
  const calculation = getSimpleCalculation({
    draft: props.app.state.sessionDraft,
    evaluation,
    now: props.now,
  });
  return (
    <main style={{ padding: 16, maxWidth: 560, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <SimpleHeader title="1周目" areaName={getAreaName(areaId)} onOpenSettings={props.onOpenSettings} />
      <BasisAndHoliday app={props.app} evaluation={evaluation} now={props.now} />
      <section style={{ ...panelStyle, border: "3px solid #b42318", background: "#fff7ed" }}>
        <p style={{ margin: "0 0 14px", fontSize: 21, fontWeight: 900, lineHeight: 1.55 }}>
          多い商品を{calculation.rateSnapshot.mainRateText}にしてください。
        </p>
        <p style={{ margin: "0 0 14px", fontWeight: 900, lineHeight: 1.55 }}>
          そのうち10個以上ある商品は{calculation.rateSnapshot.tenOrMoreRateText ?? calculation.rateSnapshot.mainRateText}にしてください。
        </p>
        <p style={{ margin: "0 0 10px", fontWeight: 800, lineHeight: 1.55 }}>
          それ以外の商品は、まだ値引しないでください。
        </p>
        <p style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
          多いか迷った商品は、多い商品として扱ってください。
        </p>
        <p style={{ margin: 0, lineHeight: 1.55 }}>1個しかない商品は値引しないでください。</p>
      </section>
      <PrimaryButton onClick={() => props.app.actions.completeFirstLapArea(calculation.rateSnapshot)}>
        次へ
      </PrimaryButton>
    </main>
  );
}

function SecondLapScreen(props: {
  app: UseSimpleModeResult;
  onOpenSettings: () => void;
}) {
  const areaId = props.app.state.currentAreaId;
  if (!areaId) return null;
  const rate = props.app.state.firstLapRates[areaId]?.mainRateText ?? "表示値引率";
  const isLast = props.app.state.currentIndex >= props.app.activeRoute.length - 1;
  return (
    <main style={{ padding: 16, maxWidth: 560, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <SimpleHeader title="2周目" areaName={getAreaName(areaId)} onOpenSettings={props.onOpenSettings} />
      <aside
        role="note"
        style={{
          marginBottom: 16,
          padding: "12px 14px",
          border: "2px solid #0369a1",
          borderRadius: 12,
          background: "#f0f9ff",
          color: "#0c4a6e",
          fontWeight: 900,
          lineHeight: 1.6,
          textAlign: "left",
        }}
      >
        ここからは時間に余裕がある場合のみ行ってください。他にやることができたら、途中で切り上げて構いません。
      </aside>
      <section style={{ ...panelStyle, border: "3px solid #b42318", background: "#fff7ed" }}>
        <p style={{ margin: "0 0 14px", fontSize: 21, fontWeight: 900, lineHeight: 1.6 }}>
          まだ値引していない商品のうち、少ない商品以外を{rate}にしてください。
        </p>
        <p style={{ margin: 0, lineHeight: 1.6 }}>
          1周目で値引した商品には、もう一度値引シールを貼らないでください。残り1個の商品は対象外です。
        </p>
      </section>
      {isLast ? (
        <p style={{ margin: "18px 0 0", fontWeight: 800, color: "#475569" }}>
          このエリアまでで2周目は終了です。
        </p>
      ) : (
        <PrimaryButton onClick={props.app.actions.completeSecondLapArea}>次へ</PrimaryButton>
      )}
    </main>
  );
}

function FinalScreen(props: { app: UseSimpleModeResult; onOpenSettings: () => void }) {
  return (
    <main style={{ padding: 16, maxWidth: 560, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <SimpleHeader title="20時30分 最終値引" onOpenSettings={props.onOpenSettings} />
      <section style={{ ...panelStyle, border: "3px solid #b42318", background: "#fff7ed", textAlign: "left" }}>
        <p style={{ margin: "0 0 16px", fontSize: 21, fontWeight: 900, lineHeight: 1.65 }}>
          19時30分の判定結果をもとに、以下の順番で、すべての商品を50％にしてください。
        </p>
        <ol style={{ margin: 0, paddingLeft: 30, display: "grid", gap: 9, fontWeight: 800 }}>
          {props.app.state.finalRoute.map((areaId) => (
            <li key={areaId}>{getAreaName(areaId)}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}

export function SimpleModeApp(props: {
  app: UseSimpleModeResult;
  testNow?: Date | null;
  onOpenSettings: () => void;
}) {
  const now = useMemo(() => props.testNow ? new Date(props.testNow) : new Date(), [props.testNow]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [props.app.state.currentAreaId, props.app.state.phase]);

  if (props.app.state.phase === "final") {
    return <FinalScreen app={props.app} onOpenSettings={props.onOpenSettings} />;
  }
  if (props.app.state.phase === "weather") {
    return (
      <StartScreen
        sessionDraft={props.app.state.sessionDraft}
        weatherGuideText={getWeatherGuideText()}
        showAfterRainRecoverySelector={false}
        onChangeSessionDraft={props.app.actions.updateSessionDraft}
        onStart={props.app.actions.startSession}
        startButtonLabel="エリア判定へ進む"
        now={now}
        onOpenSettings={props.onOpenSettings}
        modeLabel="簡易モード"
        allowedDiscountTimes={["17", "18", "19"]}
        resolveAutomaticDiscountTime={(date) => resolveSimpleDiscountTime(date) as "17" | "18" | "19"}
      />
    );
  }
  if (props.app.state.phase === "judgment") {
    return <JudgmentScreen app={props.app} now={now} onOpenSettings={props.onOpenSettings} />;
  }
  if (props.app.state.phase === "first_lap") {
    return <FirstLapScreen app={props.app} now={now} onOpenSettings={props.onOpenSettings} />;
  }
  return <SecondLapScreen app={props.app} onOpenSettings={props.onOpenSettings} />;
}
