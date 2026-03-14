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