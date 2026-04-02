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

      {app.state.screen !== "start" && app.state.screen !== "done" ? (
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px 24px" }}>
          <button
            type="button"
            onClick={handleGoTop}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #ccc",
              background: "#fff",
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            トップに戻る
          </button>
        </div>
      ) : null}
    </>
  );
}
