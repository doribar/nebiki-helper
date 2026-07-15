import { useEffect, useRef, useState } from "react";
import { AppRouter } from "./AppRouter";
import { useNebikiApp } from "../hooks/useNebikiApp";
import {
  parseExplicitTrainingStepFromHash,
  type TrainingStep,
} from "../domain/trainingMode";
import {
  loadPreferredTrainingStep,
  savePreferredTrainingStep,
} from "../domain/adminSettings";
import { AdminSettingsDialog } from "../components/common/AdminSettingsDialog";
import { withSystemBackGuardState } from "../domain/systemBackGuard";

let systemBackGuardEntryCreatedForDocument = false;

type TestModeConfig = {
  now: Date;
  timeLabel: string;
  dateLabel: string;
};

function getCurrentTrainingStep(): TrainingStep {
  if (typeof window === "undefined") return "step8";

  return (
    parseExplicitTrainingStepFromHash(window.location.hash) ??
    loadPreferredTrainingStep()
  );
}

function formatLocalDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseTestDate(value: string | null): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [yearText, monthText, dayText] = value.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const parsed = new Date(year, month - 1, day);

    if (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
    ) {
      return parsed;
    }
  }

  return new Date();
}

function parseTestTime(value: string | null): { hours: number; minutes: number; label: string } | null {
  if (!value) return null;

  const normalized = value.replace(/[^0-9]/g, "");
  const map: Record<string, { hours: number; minutes: number; label: string }> = {
    "15": { hours: 15, minutes: 0, label: "15時" },
    "1500": { hours: 15, minutes: 0, label: "15時" },
    "17": { hours: 17, minutes: 0, label: "17時" },
    "1700": { hours: 17, minutes: 0, label: "17時" },
    "18": { hours: 18, minutes: 30, label: "18時30分" },
    "1830": { hours: 18, minutes: 30, label: "18時30分" },
    "19": { hours: 19, minutes: 30, label: "19時30分" },
    "1930": { hours: 19, minutes: 30, label: "19時30分" },
    "20": { hours: 20, minutes: 30, label: "20時30分" },
    "2030": { hours: 20, minutes: 30, label: "20時30分" },
  };

  return map[normalized] ?? null;
}

function getCurrentTestMode(): TestModeConfig | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const time = parseTestTime(params.get("testTime"));
  if (!time) return null;

  const date = parseTestDate(params.get("testDate"));
  date.setHours(time.hours, time.minutes, 0, 0);

  return {
    now: date,
    timeLabel: time.label,
    dateLabel: formatLocalDate(date),
  };
}

function DateChangedBlocker({ loadedDate }: { loadedDate: string }) {
  const currentDate = formatLocalDate();

  return (
    <main
      style={{
        minHeight: "100svh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "#fff5f5",
      }}
    >
      <section
        role="alert"
        aria-live="assertive"
        style={{
          width: "100%",
          maxWidth: 720,
          borderRadius: 24,
          border: "4px solid #dc2626",
          background: "#fff",
          padding: "36px 22px",
          boxShadow: "0 16px 40px rgba(0, 0, 0, 0.16)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 92,
            minHeight: 92,
            borderRadius: 999,
            background: "#dc2626",
            color: "#fff",
            fontSize: 56,
            fontWeight: 900,
            lineHeight: 1,
            marginBottom: 20,
          }}
        >
          !
        </div>

        <h1
          style={{
            margin: "0 0 18px",
            color: "#991b1b",
            fontSize: "clamp(36px, 10vw, 64px)",
            lineHeight: 1.05,
            fontWeight: 900,
            letterSpacing: "-0.04em",
          }}
        >
          ページを更新してください
        </h1>

        <p
          style={{
            margin: "0 0 10px",
            color: "#111827",
            fontSize: "clamp(22px, 5.8vw, 34px)",
            lineHeight: 1.35,
            fontWeight: 900,
          }}
        >
          日付が変わったため、更新しないとアプリは使えません。
        </p>

        <p
          style={{
            margin: "0 0 28px",
            color: "#4b5563",
            fontSize: 16,
            lineHeight: 1.6,
            fontWeight: 700,
          }}
        >
          開いた日: {loadedDate} ／ 今日: {currentDate}
        </p>

        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            width: "100%",
            maxWidth: 420,
            minHeight: 68,
            border: 0,
            borderRadius: 16,
            background: "#dc2626",
            color: "#fff",
            fontSize: 24,
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          ページを更新する
        </button>
      </section>
    </main>
  );
}

function TestModeBanner({ testMode }: { testMode: TestModeConfig }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        left: 8,
        zIndex: 9999,
        borderRadius: 999,
        background: "#111827",
        color: "#fff",
        padding: "6px 10px",
        fontSize: 12,
        fontWeight: 800,
        boxShadow: "0 6px 18px rgba(0, 0, 0, 0.18)",
        opacity: 0.88,
        pointerEvents: "none",
      }}
    >
      動作確認モード：{testMode.dateLabel} {testMode.timeLabel}固定
    </div>
  );
}

export default function App() {
  const testMode = getCurrentTestMode();
  const [trainingStep, setTrainingStep] = useState(getCurrentTrainingStep);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const systemBackGuardUrlRef = useRef(
    typeof window === "undefined" ? "" : window.location.href,
  );
  const [loadedDate] = useState(() => formatLocalDate(testMode?.now));
  const [todayDate, setTodayDate] = useState(() => formatLocalDate(testMode?.now));
  const app = useNebikiApp({ trainingStep, testNow: testMode?.now ?? null });
  const hasDateChanged = !testMode && todayDate !== loadedDate;

  useEffect(() => {
    const handleSystemBack = () => {
      window.history.pushState(
        withSystemBackGuardState(window.history.state),
        "",
        systemBackGuardUrlRef.current,
      );
    };

    if (!systemBackGuardEntryCreatedForDocument) {
      window.history.pushState(
        withSystemBackGuardState(window.history.state),
        "",
        systemBackGuardUrlRef.current,
      );
      systemBackGuardEntryCreatedForDocument = true;
    }

    window.addEventListener("popstate", handleSystemBack);
    return () => window.removeEventListener("popstate", handleSystemBack);
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      setTrainingStep(getCurrentTrainingStep());
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const handleSaveTrainingStep = (nextStep: TrainingStep) => {
    savePreferredTrainingStep(nextStep);

    if (window.location.hash) {
      const nextUrl = `${window.location.pathname}${window.location.search}`;
      systemBackGuardUrlRef.current = new URL(nextUrl, window.location.href).href;
      window.history.replaceState(
        withSystemBackGuardState(window.history.state),
        "",
        nextUrl,
      );
    }

    setTrainingStep(nextStep);
    setSettingsOpen(false);
  };

  useEffect(() => {
    const updateTodayDate = () => {
      setTodayDate(formatLocalDate(testMode?.now));
    };

    const intervalId = window.setInterval(updateTodayDate, 30 * 1000);
    window.addEventListener("focus", updateTodayDate);
    document.addEventListener("visibilitychange", updateTodayDate);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", updateTodayDate);
      document.removeEventListener("visibilitychange", updateTodayDate);
    };
  }, [testMode?.now.getTime()]);

  if (hasDateChanged) {
    return <DateChangedBlocker loadedDate={loadedDate} />;
  }

  return (
    <>
      {testMode ? <TestModeBanner testMode={testMode} /> : null}
      <AppRouter
        app={app}
        testNow={testMode?.now ?? null}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {settingsOpen ? (
        <AdminSettingsDialog
          currentStep={trainingStep}
          onSaveStep={handleSaveTrainingStep}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </>
  );
}
