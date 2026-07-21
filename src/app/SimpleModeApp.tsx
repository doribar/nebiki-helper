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
  DAY_BEFORE_HOLIDAY_NOTICE_TEXT,
  HOLIDAY_BEFORE_NORMAL_WEEKDAY_NOTICE_TEXT,
  THREE_DAY_HOLIDAY_MIDDLE_NOTICE_TEXT,
} from "../components/common/DayBeforeHolidayNotice.ts";
import { StartScreen } from "../components/screens/StartScreen.tsx";

const EVALUATIONS: AreaCountEvaluation[] = [
  "many",
  "slightly_many",
  "normal",
  "slightly_few",
  "few",
];

const pageStyle: CSSProperties = {
  height: "100dvh",
  minHeight: "100dvh",
  width: "100%",
  maxWidth: 560,
  margin: "0 auto",
  padding: "8px 12px calc(8px + env(safe-area-inset-bottom))",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  background: "#f8fafc",
  color: "#172033",
};

const instructionCardStyle: CSSProperties = {
  border: "1px solid #f5c2ba",
  borderRadius: 14,
  background: "linear-gradient(145deg, #fff7ed 0%, #fff 82%)",
  textAlign: "center",
  padding: "9px 14px 10px",
  boxShadow: "0 3px 10px rgba(15, 23, 42, 0.035)",
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
        width: 44,
        height: 44,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 12,
        border: "1px solid #d5dde8",
        background: "#fff",
        color: "#334155",
        fontSize: 20,
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
    <header
      data-simple-ui="header"
      aria-label={props.title}
      style={{ marginBottom: 7, padding: "2px 0 7px", borderBottom: "1px solid #dbe4ec", flexShrink: 0 }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 44px", alignItems: "center", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#475569", fontSize: 12, fontWeight: 850, lineHeight: 1.2 }}>
            <span style={{ color: "#155e75", fontWeight: 950 }}>簡易モード</span>
            <span>{getSimpleDiscountTimeDisplay(props.discountTime)}</span>
            {hasProgress ? <span style={{ marginLeft: "auto", fontWeight: 950 }}>{props.progressIndex}/{props.progressTotal}</span> : null}
          </div>
          <h1
            style={{
              margin: "3px 0 0",
              overflow: "hidden",
              color: "#172033",
              fontSize: props.areaName ? "clamp(21px, 6vw, 25px)" : 24,
              fontWeight: 900,
              lineHeight: 1.2,
              letterSpacing: "-0.02em",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {props.areaName ?? props.title}
          </h1>
        </div>
        <SettingsButton onClick={props.onOpenSettings} />
      </div>

      {hasProgress ? (
        <div
          role="progressbar"
          aria-label="エリア進捗"
          aria-valuemin={0}
          aria-valuemax={props.progressTotal}
          aria-valuenow={props.progressIndex}
          style={{ height: 3, marginTop: 5, overflow: "hidden", borderRadius: 999, background: "#e2e8f0" }}
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

function CompactHolidayNotice(props: { ariaLabel: string; text: string }) {
  return (
    <aside
      role="note"
      aria-label={props.ariaLabel}
      style={{
        padding: "6px 9px",
        borderLeft: "3px solid #b45309",
        borderRadius: 7,
        background: "#fff7ed",
        color: "#7c2d12",
        fontSize: 13,
        fontWeight: 800,
        lineHeight: 1.35,
      }}
    >
      {props.text}
    </aside>
  );
}

function CompactDetailRow(props: { summaryText?: string; detailLines?: string[] }) {
  if (!props.summaryText) return null;
  const hasDetails = Boolean(props.detailLines?.length);
  if (!hasDetails) {
    return <div style={{ fontWeight: 750 }}>{props.summaryText}</div>;
  }
  return (
    <details style={{ minWidth: 0 }}>
      <summary style={{ minHeight: 28, cursor: "pointer", fontWeight: 750, lineHeight: "28px" }}>
        {props.summaryText}
      </summary>
      <div style={{ padding: "2px 0 3px 12px", display: "grid", gap: 2 }}>
        {props.detailLines?.map((line) => <div key={line}>・{line}</div>)}
      </div>
    </details>
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
    <section data-simple-ui="basis" style={{ marginBottom: 7, display: "grid", gap: 5, flexShrink: 0 }}>
      <div
        style={{
          padding: "6px 9px",
          borderRadius: 7,
          borderLeft: "3px solid #0f766e",
          background: "#f0fdfa",
          color: "#134e4a",
          fontSize: 13,
          lineHeight: 1.35,
        }}
      >
        <p style={{ margin: 0, fontWeight: 800 }}>
          {calculation.basisGuide.referenceText}、残り数を判断してください。
        </p>
      </div>
      {notices.dayBefore ? <CompactHolidayNotice ariaLabel="祝前日の注意" text={DAY_BEFORE_HOLIDAY_NOTICE_TEXT} /> : null}
      {notices.threeDayMiddle ? <CompactHolidayNotice ariaLabel="三連休中日の注意" text={THREE_DAY_HOLIDAY_MIDDLE_NOTICE_TEXT} /> : null}
      {notices.holidayBeforeWeekday ? <CompactHolidayNotice ariaLabel="翌日平日祝日の注意" text={HOLIDAY_BEFORE_NORMAL_WEEKDAY_NOTICE_TEXT} /> : null}
      <div
        data-simple-ui="basis-details"
        style={{
          padding: "6px 9px",
          border: "1px solid #dbe4ec",
          borderRadius: 7,
          background: "#f8fafc",
          color: "#334155",
          display: "grid",
          gap: 3,
          fontSize: 12.5,
          lineHeight: 1.35,
        }}
      >
        {calculation.basisGuide.noticeText ? <div>{calculation.basisGuide.noticeText}</div> : null}
        <CompactDetailRow summaryText={calculation.basisGuide.weekdaySummaryText} detailLines={calculation.basisGuide.weekdayDetailLines} />
        <CompactDetailRow summaryText={calculation.basisGuide.bonusSummaryText} detailLines={calculation.basisGuide.bonusDetailLines} />
      </div>
    </section>
  );
}

function SimpleRules({ children }: { children: ReactNode }) {
  return (
    <section data-simple-ui="rules" style={{ marginTop: 7, padding: "5px 2px 2px", borderTop: "1px solid #e2e8f0" }}>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 3 }}>
        {children}
      </ul>
    </section>
  );
}

function RuleItem({ children }: { children: ReactNode }) {
  return (
    <li style={{ display: "grid", gridTemplateColumns: "16px minmax(0, 1fr)", gap: 5, alignItems: "start", fontSize: 14, lineHeight: 1.35 }}>
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
        marginTop: "auto",
        paddingTop: 6,
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={props.onClick}
        style={{
          width: "100%",
          minHeight: 50,
          padding: "8px 18px",
          border: 0,
          borderRadius: 16,
          background: "#b42318",
          color: "#fff",
          fontSize: 18,
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
    <main data-simple-screen="judgment" style={pageStyle}>
      <SimpleHeader
        title="エリアの残数判定"
        areaName={getAreaName(areaId)}
        discountTime={props.app.state.discountTime}
        progressIndex={props.app.state.currentIndex + 1}
        progressTotal={props.app.route.length}
        onOpenSettings={props.onOpenSettings}
      />
      <h2 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 850, lineHeight: 1.35, flexShrink: 0 }}>
        このエリアの残り具合を選んでください
      </h2>
      <BasisAndHoliday app={props.app} now={props.now} />
      <section aria-label="5段階判定" style={{ display: "grid", gap: 6, flex: "1 1 auto", alignContent: "center", minHeight: 0 }}>
        {EVALUATIONS.map((evaluation) => (
          <button
            key={evaluation}
            type="button"
            onClick={() => props.app.actions.judgeCurrentArea(evaluation)}
            data-evaluation={evaluation}
            style={{
              minHeight: 50,
              padding: "7px 14px",
              borderRadius: 13,
              border: "2px solid",
              fontSize: 17,
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
    <main data-simple-screen="first-lap" style={pageStyle}>
      <SimpleHeader
        title="1周目"
        areaName={getAreaName(areaId)}
        discountTime={props.app.state.discountTime}
        progressIndex={props.app.state.currentIndex + 1}
        progressTotal={props.app.route.length}
        onOpenSettings={props.onOpenSettings}
      />
      <div style={{ marginBottom: 5, color: "#7c2d12", fontSize: 12, fontWeight: 950, letterSpacing: "0.04em" }}>1周目</div>
      <section aria-label="1周目の値引指示" data-simple-ui="instruction-card" style={instructionCardStyle}>
        <p style={{ margin: 0, color: "#7c2d12", fontSize: 15, fontWeight: 900, lineHeight: 1.2 }}>多い商品</p>
        <div
          data-simple-ui="discount-rate"
          style={{ margin: "1px 0 3px", color: "#b42318", fontSize: "clamp(46px, 14vw, 58px)", fontWeight: 950, lineHeight: 0.98 }}
        >
          {calculation.rateSnapshot.mainRateText}
        </div>
        <p style={{ margin: 0, color: "#475569", fontSize: 14, lineHeight: 1.3 }}>
          10個以上は
          <strong style={{ marginLeft: 4, color: "#9a3412", fontSize: 18 }}>
            {calculation.rateSnapshot.tenOrMoreRateText ?? calculation.rateSnapshot.mainRateText}
          </strong>
        </p>
      </section>
      <SimpleRules>
        <RuleItem>1個の商品は値引しない</RuleItem>
        <RuleItem>それ以外の商品は、まだ値引しない</RuleItem>
        <RuleItem>多いか迷った商品は値引する</RuleItem>
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
    <main data-simple-screen="second-lap" style={pageStyle}>
      <SimpleHeader
        title="2周目"
        areaName={getAreaName(areaId)}
        discountTime={props.app.state.discountTime}
        progressIndex={props.app.state.currentIndex + 1}
        progressTotal={props.app.activeRoute.length}
        onOpenSettings={props.onOpenSettings}
      />
      <div style={{ marginBottom: 5, color: "#0c4a6e", fontSize: 12, fontWeight: 950, letterSpacing: "0.04em" }}>2周目</div>
      <aside
        role="note"
        style={{
          marginBottom: 6,
          padding: "7px 9px",
          borderLeft: "3px solid #38bdf8",
          borderRadius: 7,
          background: "#f0f9ff",
          color: "#0c4a6e",
          fontSize: 12.5,
          fontWeight: 750,
          lineHeight: 1.35,
          textAlign: "left",
        }}
      >
        ここからは時間に余裕がある場合のみ行ってください。他にやることができたら、途中で切り上げて構いません。
      </aside>
      <section aria-label="2周目の値引指示" data-simple-ui="instruction-card" style={instructionCardStyle}>
        <p style={{ margin: 0, color: "#7c2d12", fontSize: 15, fontWeight: 900, lineHeight: 1.2 }}>少ない商品以外</p>
        <div
          data-simple-ui="discount-rate"
          style={{ marginTop: 1, color: "#b42318", fontSize: "clamp(46px, 14vw, 58px)", fontWeight: 950, lineHeight: 0.98 }}
        >
          {rate}
        </div>
      </section>
      <SimpleRules>
        <RuleItem>まだ値引していない商品が対象</RuleItem>
        <RuleItem>1個の商品は値引しない</RuleItem>
        <RuleItem>10個以上の＋5％はしない</RuleItem>
      </SimpleRules>
      {isLast ? (
        <p style={{ margin: "8px 0 0", padding: "8px 10px", borderRadius: 8, background: "#ecfdf5", color: "#166534", fontSize: 14, fontWeight: 900 }}>
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
    <main data-simple-screen="final" style={pageStyle}>
      <SimpleHeader
        title="最終値引"
        discountTime={props.app.state.discountTime}
        onOpenSettings={props.onOpenSettings}
      />
      <section aria-label="最終値引指示" data-simple-ui="instruction-card" style={instructionCardStyle}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 7 }}>
          <span style={{ color: "#7c2d12", fontSize: 15, fontWeight: 900 }}>全品</span>
          <strong
            data-simple-ui="discount-rate"
            style={{ color: "#b42318", fontSize: "clamp(44px, 13vw, 54px)", fontWeight: 950, lineHeight: 0.95 }}
          >
            50％
          </strong>
        </div>
        <p style={{ margin: "3px 0 0", color: "#475569", fontSize: 13, lineHeight: 1.35 }}>
          19:30の判定結果をもとに、以下の順番で、すべての商品を50％にしてください。
        </p>
      </section>
      <section style={{ marginTop: 7, minHeight: 0 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 900 }}>値引する順番</h2>
        <ol data-simple-ui="final-route" style={{ margin: 0, padding: 0, listStyle: "none", borderTop: "1px solid #dbe4ec" }}>
          {props.app.state.finalRoute.map((areaId, index) => (
            <li
              key={areaId}
              style={{
                display: "grid",
                gridTemplateColumns: "27px minmax(0, 1fr)",
                alignItems: "center",
                gap: 5,
                minHeight: 31,
                padding: "2px 8px",
                borderBottom: "1px solid #e2e8f0",
                background: index % 2 === 0 ? "#fff" : "#f8fafc",
                fontSize: 14,
                fontWeight: 800,
                lineHeight: 1.2,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  color: "#155e75",
                  fontSize: 13,
                  fontWeight: 950,
                  textAlign: "right",
                }}
              >
                {index + 1}.
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
