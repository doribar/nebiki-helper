import { useEffect, useState } from "react";
import { AppRouter } from "./AppRouter";
import { useNebikiApp } from "../hooks/useNebikiApp";
import { parseTrainingStepFromHash } from "../domain/trainingMode";

function getCurrentTrainingStep() {
  if (typeof window === "undefined") return parseTrainingStepFromHash("");
  return parseTrainingStepFromHash(window.location.hash);
}

function formatLocalDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
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

export default function App() {
  const [trainingStep, setTrainingStep] = useState(getCurrentTrainingStep);
  const [loadedDate] = useState(() => formatLocalDate());
  const [todayDate, setTodayDate] = useState(() => formatLocalDate());
  const app = useNebikiApp({ trainingStep });
  const hasDateChanged = todayDate !== loadedDate;

  useEffect(() => {
    const handleHashChange = () => {
      setTrainingStep(getCurrentTrainingStep());
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    const updateTodayDate = () => {
      setTodayDate(formatLocalDate());
    };

    const intervalId = window.setInterval(updateTodayDate, 30 * 1000);
    window.addEventListener("focus", updateTodayDate);
    document.addEventListener("visibilitychange", updateTodayDate);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", updateTodayDate);
      document.removeEventListener("visibilitychange", updateTodayDate);
    };
  }, []);

  if (hasDateChanged) {
    return <DateChangedBlocker loadedDate={loadedDate} />;
  }

  return <AppRouter app={app} />;
}
