import { type CSSProperties, type ReactNode, useEffect, useMemo } from "react";
import { getAreaName } from "../domain/area.ts";
import {
  getSimpleCalculation,
  getSimpleHolidayNotices,
  resolveSimpleDiscountTime,
  type SimpleDiscountTime,
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
import { StartScreen } from "../components/screens/StartScreen.tsx";

const EVALUATIONS: AreaCountEvaluation[] = [
  "many",
  "slightly_many",
  "normal",
  "slightly_few",
  "few",
];

const pageStyle: CSSProperties = {
  minHeight: "100dvh",
  width: "100%",
  maxWidth: 560,
  margin: "0 auto",
  padding: "14px 16px 28px",
  boxSizing: "border-box",
  overflowX: "hidden",
  background: "#f8fafc",
  color: "#172033",
};

const cardStyle: CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 18,
  padding: 18,
  background: "#fff",
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.05)",
};

const instructionCardStyle: CSSProperties = {
  ...cardStyle,
  border: "1px solid #f5c2ba",
  background: "linear-gradient(145deg, #fff7ed 0%, #fff 78%)",
  textAlign: "center",
  padding: "22px 18px",
};

const EVALUATION_TONES: Record<AreaCountEvaluation, CSSProperties> = {
  many: {
    background: "#fff1f2",
    borderColor: "#fda4af",
    color: "#9f1239",
  },
  slightly_many: {
    background: "#fffbeb",
    borderColor: "#fcd34d",
    color: "#92400e",
  },
  normal: {
    background: "#eff6ff",
    borderColor: "#93c5fd",
    color: "#1e40af",
  },
  slightly_few: {
    background: "#f0fdfa",
    borderColor: "#99f6e4",
    color: "#115e59",
  },
  few: {
    background: "#f8fafc",
    borderColor: "#cbd5e1",
    color: "#475569",
  },
};

function simpleEvaluationText(evaluation: AreaCountEvaluation): string {
  switch (evaluation) {
    case "many": return "多い";
    case "slightly_many": return "やや多い";
    case "normal": return "普通";
    case "slightly_few": return "やや少ない";
    case "few": return "少ない";
  }
}

function getSimpleDiscountTimeDisplay(discountTime: SimpleDiscountTime): string {
  switch (discountTime) {
    case "17": return "17:00値引";
    case "18": return "18:30値引";
    case "19": return "19:30値引";
    case "20": return "20:30値引";
  }
}

function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="設定を開く"
      title="設定"
      style={{
        width: 48,
        height: 48,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 15,
        border: "1px solid #d5dde8",
        background: "#fff",
        color: "#334155",
        fontSize: 22,
        cursor: "pointer",
        boxShadow: "0 3px 10px rgba(15, 23, 42, 0.06)",
      }}
    >
      ⚙
    </button>
  );
}

function SimpleHeader(props: {
  title: string;
  areaName?: string | null;
  discountTime: SimpleDiscountTime;
  progressIndex?: number;
  progressTotal?: number;
  onOpenSettings: () => void;
}) {
  const hasProgress = typeof props.progressIndex === "number" && typeof props.progressTotal === "number" && props.progressTotal > 0;
  const progressPercent = hasProgress
    ? Math.min(100, Math.max(0, (props.progressIndex! / props.progressTotal!) * 100))
    : 0;

  return (
    <header data-simple-ui="header" style={{ ...cardStyle, marginBottom: 20, padding: "14px 16px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 28,
            padding: "3px 10px",
            borderRadius: 999,
            background: "#e8f3f5",
            color: "#155e75",
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: "0.02em",
          }}
        >
          簡易モード
        </span>
        <SettingsButton onClick={props.onOpenSettings} />
      </div>

      {props.areaName ? (
        <>
          <p style={{ margin: "12px 0 4px", color: "#64748b", fontSize: 13, fontWeight: 800 }}>
            {props.title}
          </p>
          <h1 style={{ margin: 0, fontSize: "clamp(26px, 8vw, 34px)", lineHeight: 1.25, letterSpacing: "-0.02em" }}>
            {props.areaName}
          </h1>
        </>
      ) : (
        <h1 style={{ margin: "12px 0 0", fontSize: 30, lineHeight: 1.25 }}>{props.title}</h1>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12 }}>
        <span style={{ color: "#475569", fontSize: 13, fontWeight: 800 }}>
          {getSimpleDiscountTimeDisplay(props.discountTime)}
        </span>
        {hasProgress ? (
          <span style={{ color: "#475569", fontSize: 13, fontWeight: 900 }}>
            {props.progressIndex} / {props.progressTotal}
          </span>
        ) : null}
      </div>

      {hasProgress ? (
        <div
          role="progressbar"
          aria-label="エリア進捗"
          aria-valuemin={0}
          aria-valuemax={props.progressTotal}
          aria-valuenow={props.progressIndex}
          style={{ height: 6, marginTop: 8, overflow: "hidden", borderRadius: 999, background: "#e2e8f0" }}
        >
          <div
            style={{
              width: `${progressPercent}%`,
              height: "100%",
              borderRadius: 999,
              background: "#0f766e",
            }}
          />
        </div>
      ) : null}
    </header>
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
    <section data-simple-ui="basis" style={{ marginBottom: 18 }}>
      <div
        style={{
          marginBottom: 12,
          padding: "12px 14px",
          borderRadius: 14,
          borderLeft: "4px solid #0f766e",
          background: "#f0fdfa",
          color: "#134e4a",
        }}
      >
        <p style={{ margin: 0, fontWeight: 800, lineHeight: 1.6 }}>
          {calculation.basisGuide.referenceText}、残り数を判断してください。
        </p>
      </div>
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
    </section>
  );
}

function SimpleRules({ children }: { children: ReactNode }) {
  return (
    <section data-simple-ui="rules" style={{ ...cardStyle, marginTop: 14, padding: "15px 16px" }}>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 11 }}>
        {children}
      </ul>
    </section>
  );
}

function RuleItem({ children }: { children: ReactNode }) {
  return (
    <li style={{ display: "grid", gridTemplateColumns: "22px minmax(0, 1fr)", gap: 8, alignItems: "start", lineHeight: 1.55 }}>
      <span aria-hidden="true" style={{ color: "#0f766e", fontWeight: 900 }}>✓</span>
      <span>{children}</span>
    </li>
  );
}

function SimpleActionButton(props: { children: ReactNode; onClick: () => void }) {
  return (
    <div
      data-simple-ui="action-area"
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: 2,
        marginTop: 18,
        padding: "14px 0 calc(10px + env(safe-area-inset-bottom))",
        background: "linear-gradient(to bottom, rgba(248, 250, 252, 0), #f8fafc 24%)",
      }}
    >
      <button
        type="button"
        onClick={props.onClick}
        style={{
          width: "100%",
          minHeight: 60,
          padding: "14px 20px",
          border: 0,
          borderRadius: 16,
          background: "#b42318",
          color: "#fff",
          fontSize: 19,
          fontWeight: 900,
          letterSpacing: "0.03em",
          cursor: "pointer",
          boxShadow: "0 8px 20px rgba(180, 35, 24, 0.22)",
        }}
      >
        {props.children}
      </button>
    </div>
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
    <main style={pageStyle}>
      <SimpleHeader
        title="エリアの残数判定"
        areaName={getAreaName(areaId)}
        discountTime={props.app.state.discountTime}
        progressIndex={props.app.state.currentIndex + 1}
        progressTotal={props.app.route.length}
        onOpenSettings={props.onOpenSettings}
      />
      <h2 style={{ margin: "0 0 14px", fontSize: 21, lineHeight: 1.45 }}>
        このエリアの残り具合を選んでください
      </h2>
      <BasisAndHoliday app={props.app} now={props.now} />
      <section aria-label="5段階判定" style={{ display: "grid", gap: 10 }}>
        {EVALUATIONS.map((evaluation) => (
          <button
            key={evaluation}
            type="button"
            onClick={() => props.app.actions.judgeCurrentArea(evaluation)}
            data-evaluation={evaluation}
            style={{
              minHeight: 60,
              padding: "12px 16px",
              borderRadius: 16,
              border: "2px solid",
              fontSize: 19,
              fontWeight: 900,
              cursor: "pointer",
              boxShadow: "0 3px 10px rgba(15, 23, 42, 0.04)",
              ...EVALUATION_TONES[evaluation],
            }}
          >
            {simpleEvaluationText(evaluation)}
          </button>
        ))}
      </section>
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
    <main style={pageStyle}>
      <SimpleHeader
        title="1周目"
        areaName={getAreaName(areaId)}
        discountTime={props.app.state.discountTime}
        progressIndex={props.app.state.currentIndex + 1}
        progressTotal={props.app.route.length}
        onOpenSettings={props.onOpenSettings}
      />
      <section aria-label="1周目の値引指示" data-simple-ui="instruction-card" style={instructionCardStyle}>
        <p style={{ margin: 0, color: "#7c2d12", fontSize: 16, fontWeight: 900 }}>多い商品</p>
        <div
          data-simple-ui="discount-rate"
          style={{ margin: "4px 0 8px", color: "#b42318", fontSize: "clamp(52px, 17vw, 72px)", fontWeight: 950, lineHeight: 1 }}
        >
          {calculation.rateSnapshot.mainRateText}
        </div>
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.6 }}>
          10個以上ある商品は
          <strong style={{ marginLeft: 5, color: "#9a3412", fontSize: 20 }}>
            {calculation.rateSnapshot.tenOrMoreRateText ?? calculation.rateSnapshot.mainRateText}
          </strong>
        </p>
      </section>
      <SimpleRules>
        <RuleItem>多い商品だけを値引する</RuleItem>
        <RuleItem>1個の商品は値引しない</RuleItem>
        <RuleItem>それ以外の商品は、まだ値引しない</RuleItem>
        <RuleItem>多いか迷った商品は値引してください</RuleItem>
      </SimpleRules>
      <SimpleActionButton onClick={() => props.app.actions.completeFirstLapArea(calculation.rateSnapshot)}>
        次へ
      </SimpleActionButton>
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
    <main style={pageStyle}>
      <SimpleHeader
        title="2周目"
        areaName={getAreaName(areaId)}
        discountTime={props.app.state.discountTime}
        progressIndex={props.app.state.currentIndex + 1}
        progressTotal={props.app.activeRoute.length}
        onOpenSettings={props.onOpenSettings}
      />
      <aside
        role="note"
        style={{
          marginBottom: 14,
          padding: "12px 14px",
          border: "1px solid #bae6fd",
          borderRadius: 14,
          background: "#f0f9ff",
          color: "#0c4a6e",
          fontSize: 14,
          fontWeight: 750,
          lineHeight: 1.6,
          textAlign: "left",
        }}
      >
        <span aria-hidden="true" style={{ marginRight: 7 }}>⏱</span>
        ここからは時間に余裕がある場合のみ行ってください。他にやることができたら、途中で切り上げて構いません。
      </aside>
      <section aria-label="2周目の値引指示" data-simple-ui="instruction-card" style={instructionCardStyle}>
        <p style={{ margin: 0, color: "#7c2d12", fontSize: 16, fontWeight: 900 }}>少ない商品以外</p>
        <div
          data-simple-ui="discount-rate"
          style={{ marginTop: 4, color: "#b42318", fontSize: "clamp(52px, 17vw, 72px)", fontWeight: 950, lineHeight: 1 }}
        >
          {rate}
        </div>
      </section>
      <SimpleRules>
        <RuleItem>まだ値引していない商品が対象</RuleItem>
        <RuleItem>1周目で値引した商品には、もう一度値引シールを貼らない</RuleItem>
        <RuleItem>1個の商品は値引しない</RuleItem>
        <RuleItem>10個以上でも+5％はしない</RuleItem>
      </SimpleRules>
      {isLast ? (
        <p style={{ margin: "18px 0 0", padding: "14px 16px", borderRadius: 14, background: "#ecfdf5", color: "#166534", fontWeight: 900 }}>
          このエリアまでで2周目は終了です。
        </p>
      ) : (
        <SimpleActionButton onClick={props.app.actions.completeSecondLapArea}>次へ</SimpleActionButton>
      )}
    </main>
  );
}

function FinalScreen(props: { app: UseSimpleModeResult; onOpenSettings: () => void }) {
  return (
    <main style={pageStyle}>
      <SimpleHeader
        title="最終値引"
        discountTime={props.app.state.discountTime}
        onOpenSettings={props.onOpenSettings}
      />
      <section aria-label="最終値引指示" data-simple-ui="instruction-card" style={instructionCardStyle}>
        <p style={{ margin: 0, color: "#7c2d12", fontSize: 16, fontWeight: 900 }}>すべての商品</p>
        <div
          data-simple-ui="discount-rate"
          style={{ margin: "4px 0 10px", color: "#b42318", fontSize: "clamp(58px, 19vw, 80px)", fontWeight: 950, lineHeight: 1 }}
        >
          50％
        </div>
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.65 }}>
          19:30の判定結果をもとに、以下の順番で並べています。
          <br />
          上から順に、すべての商品を50％にしてください。
        </p>
      </section>
      <section style={{ marginTop: 18 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 19 }}>値引する順番</h2>
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 9 }}>
          {props.app.state.finalRoute.map((areaId, index) => (
            <li
              key={areaId}
              style={{
                display: "grid",
                gridTemplateColumns: "34px minmax(0, 1fr)",
                alignItems: "center",
                gap: 11,
                minHeight: 54,
                padding: "9px 14px 9px 10px",
                border: "1px solid #e2e8f0",
                borderRadius: 14,
                background: "#fff",
                fontWeight: 850,
                boxShadow: "0 3px 10px rgba(15, 23, 42, 0.035)",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 32,
                  height: 32,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 10,
                  background: "#e8f3f5",
                  color: "#155e75",
                  fontSize: 14,
                  fontWeight: 950,
                }}
              >
                {index + 1}
              </span>
              <span>{getAreaName(areaId)}</span>
            </li>
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
        emphasizeModeLabel
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
