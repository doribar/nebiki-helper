import { useEffect, useState } from "react";
import { AppRouter } from "./AppRouter";
import { useNebikiApp } from "../hooks/useNebikiApp";
import { getCanonicalUrlForLegacyHash } from "../domain/fullMode";
import { AdminSettingsDialog } from "../components/common/AdminSettingsDialog";
import {
  removeStorageKeySafely,
  reportStorageOperationFailures,
  runStartupStorageHousekeeping,
  setArchivedFinalizedDatesForStorageRetention,
} from "../domain/storage";
import {
  getHistoricalArchiveRuntimeSnapshot,
  initializeHistoricalArchiveRuntime,
} from "../domain/historicalArchiveRuntime.ts";

type TestModeConfig = {
  now: Date;
  timeLabel: string;
  dateLabel: string;
};

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

function ArchiveLoadingScreen() {
  return (
    <main
      aria-busy="true"
      style={{
        minHeight: "100svh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#f8fafc",
        color: "#334155",
        textAlign: "center",
      }}
    >
      <div>
        <div style={{ fontSize: 22, fontWeight: 900 }}>端末履歴を準備しています</div>
        <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6 }}>
          既存データを安全に確認しています。画面を閉じずにお待ちください。
        </div>
      </div>
    </main>
  );
}

function AppRoot(props: { testMode: TestModeConfig | null }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const app = useNebikiApp({ testNow: props.testMode?.now ?? null });

  useEffect(() => {
    const normalizeLegacyUrl = () => {
      const canonicalUrl = getCanonicalUrlForLegacyHash({
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
      });
      if (canonicalUrl) {
        window.history.replaceState(window.history.state, "", canonicalUrl);
      }
    };

    normalizeLegacyUrl();
    window.addEventListener("hashchange", normalizeLegacyUrl);
    return () => window.removeEventListener("hashchange", normalizeLegacyUrl);
  }, []);

  return (
    <>
      {app.state.screen !== "start" ? (
        <div
          aria-label="現在の夏季モード"
          style={{
            width: "fit-content",
            maxWidth: "calc(100vw - 32px)",
            margin: "6px auto -6px",
            padding: "3px 9px",
            border: "1px solid #cbd5e1",
            borderRadius: 999,
            background: app.derived.demandCycle === "summer" ? "#fff7ed" : "#f8fafc",
            color: "#475569",
            fontSize: 11,
            fontWeight: 800,
            lineHeight: 1.4,
            textAlign: "center",
            whiteSpace: "nowrap",
          }}
        >
          {app.derived.demandCycleBasisLabel}
        </div>
      ) : null}
      <AppRouter
        app={app}
        testNow={props.testMode?.now ?? null}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {app.derived.undoNotice ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            left: 16,
            right: 16,
            bottom: 18,
            zIndex: 10000,
            maxWidth: 480,
            margin: "0 auto",
            padding: "11px 14px",
            borderRadius: 12,
            background: "#1f2937",
            color: "#fff",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.2)",
            fontSize: 14,
            fontWeight: 800,
            lineHeight: 1.5,
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          {app.derived.undoNotice}
        </div>
      ) : null}
      {settingsOpen ? (
        <AdminSettingsDialog
          review19Count={app.derived.dataExport.review19Count}
          dailyCount={app.derived.dataExport.dailyCount}
          onExportAllReview19Data={app.actions.exportAllReview19Data}
          onExportLatestReview19Data={app.actions.exportLatestReview19Data}
          onExportAllDailyData={app.actions.exportAllDailyData}
          onExportLatestDailyData={app.actions.exportLatestDailyData}
          cloudSync={app.derived.cloudSync}
          onSyncLocalDataToSupabase={app.actions.syncLocalDataToSupabase}
          onGetStorageUsageDiagnostic={app.actions.getStorageUsageDiagnostic}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </>
  );
}

export default function App() {
  const testMode = getCurrentTestMode();
  const isTestMode = Boolean(testMode);
  const testModeNow = testMode?.now;
  const [archiveReady, setArchiveReady] = useState(isTestMode);
  const [loadedDate] = useState(() => formatLocalDate(testModeNow));
  const [todayDate, setTodayDate] = useState(() => formatLocalDate(testModeNow));
  const hasDateChanged = !testMode && todayDate !== loadedDate;

  useEffect(() => {
    // 旧簡易モード設定は移行後の処理分岐に使用せず、安全に破棄する。
    const legacyCleanupResults = [
      "nebiki-helper/app-mode-v1",
      "nebiki-helper/simple-mode-state-v1",
    ].map(removeStorageKeySafely);
    reportStorageOperationFailures(
      "legacy-mode-storage-cleanup",
      legacyCleanupResults,
    );
  }, []);

  useEffect(() => {
    if (isTestMode) return;
    let cancelled = false;
    void initializeHistoricalArchiveRuntime().then((archive) => {
      if (cancelled) return;
      setArchivedFinalizedDatesForStorageRetention(
        archive.finalizedDayRecords.map((record) => record.date),
      );
      runStartupStorageHousekeeping({
        protectedDates: [formatLocalDate()],
      });
      setArchiveReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isTestMode]);

  useEffect(() => {
    const updateTodayDate = () => setTodayDate(formatLocalDate(testModeNow));
    const intervalId = window.setInterval(updateTodayDate, 30 * 1000);
    window.addEventListener("focus", updateTodayDate);
    document.addEventListener("visibilitychange", updateTodayDate);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", updateTodayDate);
      document.removeEventListener("visibilitychange", updateTodayDate);
    };
  }, [testModeNow]);

  if (hasDateChanged) return <DateChangedBlocker loadedDate={loadedDate} />;
  if (!archiveReady && getHistoricalArchiveRuntimeSnapshot().status !== "complete") {
    return <ArchiveLoadingScreen />;
  }

  return (
    <>
      {testMode ? <TestModeBanner testMode={testMode} /> : null}
      <AppRoot testMode={testMode} />
    </>
  );
}
