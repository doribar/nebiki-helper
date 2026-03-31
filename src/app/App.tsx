import { useEffect } from "react";
import { AppRouter } from "./AppRouter";
import { useNebikiApp } from "../hooks/useNebikiApp";

export default function App() {
  const app = useNebikiApp();

  function handleGoTop() {
    const ok = window.confirm(
      "トップに戻ります。現在の進行状況はリセットされます。よろしいですか？"
    );
    if (!ok) return;

    app.actions.resetApp();
  }

  function handleEscapeToTop() {
    app.actions.resetApp();
  }

  useEffect(() => {
    if (app.state.screen === "start") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.repeat) return;

      event.preventDefault();
      handleEscapeToTop();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [app.state.screen]);

  return (
    <>
      <AppRouter app={app} />

      {app.state.screen !== "start" ? (
        <button
          type="button"
          onClick={handleGoTop}
          style={{
            position: "fixed",
            right: 12,
            top: "calc(env(safe-area-inset-top, 0px) + 12px)",
            padding: "10px 14px",
            borderRadius: 9999,
            border: "1px solid #ccc",
            background: "#fff",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
            zIndex: 1000,
          }}
        >
          トップに戻る
        </button>
      ) : null}
    </>
  );
}
