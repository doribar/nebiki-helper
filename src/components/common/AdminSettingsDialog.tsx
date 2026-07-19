import { useState } from "react";
import {
  ADMIN_PIN_MAX_LENGTH,
  hasAdminPin,
  isValidAdminPinFormat,
  saveAdminPin,
  verifyAdminPin,
} from "../../domain/adminSettings";

type AdminSettingsDialogProps = {
  review19UnexportedCount: number;
  review19TotalCount: number;
  onExportReview19Unexported: () => void;
  onExportAllReview19: () => void;
  onClose: () => void;
};

type DialogPhase = "create-pin" | "unlock" | "settings";

const panelStyle = {
  width: "min(92vw, 520px)",
  maxHeight: "88svh",
  overflowY: "auto" as const,
  borderRadius: 22,
  background: "#fff",
  padding: 20,
  boxShadow: "0 20px 60px rgba(0, 0, 0, 0.28)",
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  minHeight: 58,
  borderRadius: 12,
  border: "2px solid #cbd5e1",
  padding: "10px 14px",
  fontSize: 24,
  fontWeight: 800,
  letterSpacing: "0.25em",
  textAlign: "center" as const,
};

export function AdminSettingsDialog({
  review19UnexportedCount,
  review19TotalCount,
  onExportReview19Unexported,
  onExportAllReview19,
  onClose,
}: AdminSettingsDialogProps) {
  const [phase, setPhase] = useState<DialogPhase>(() =>
    hasAdminPin() ? "unlock" : "create-pin",
  );
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const normalizePinInput = (value: string) =>
    value.replace(/\D/g, "").slice(0, ADMIN_PIN_MAX_LENGTH);

  const handleCreatePin = async () => {
    setError(null);

    if (!isValidAdminPinFormat(pin)) {
      setError("PINは4〜8桁の数字で設定してください。");
      return;
    }

    if (pin !== pinConfirm) {
      setError("確認用PINが一致していません。");
      return;
    }

    setSubmitting(true);
    try {
      await saveAdminPin(pin);
      setPin("");
      setPinConfirm("");
      setPhase("settings");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "PINを保存できませんでした。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnlock = async () => {
    setError(null);

    if (!isValidAdminPinFormat(pin)) {
      setError("4〜8桁のPINを入力してください。");
      return;
    }

    setSubmitting(true);
    try {
      const verified = await verifyAdminPin(pin);
      if (!verified) {
        setError("PINが違います。");
        return;
      }

      setPin("");
      setPhase("settings");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="設定"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(15, 23, 42, 0.58)",
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section style={panelStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 26, lineHeight: 1.2 }}>
            {phase === "create-pin"
              ? "設定用PINを作成"
              : phase === "unlock"
                ? "PINを入力"
                : "設定"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="設定を閉じる"
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              border: "1px solid #cbd5e1",
              background: "#fff",
              fontSize: 26,
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        {phase === "create-pin" ? (
          <>
            <p style={{ margin: "0 0 16px", lineHeight: 1.6 }}>
              設定を開くための4〜8桁の数字を設定してください。
            </p>
            <label style={{ display: "block", fontWeight: 800, marginBottom: 8 }}>
              PIN
            </label>
            <input
              autoFocus
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pin}
              onChange={(event) => setPin(normalizePinInput(event.target.value))}
              maxLength={ADMIN_PIN_MAX_LENGTH}
              style={inputStyle}
            />
            <label
              style={{
                display: "block",
                fontWeight: 800,
                margin: "16px 0 8px",
              }}
            >
              PINをもう一度入力
            </label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pinConfirm}
              onChange={(event) =>
                setPinConfirm(normalizePinInput(event.target.value))
              }
              maxLength={ADMIN_PIN_MAX_LENGTH}
              style={inputStyle}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleCreatePin();
              }}
            />
            {error ? (
              <p role="alert" style={{ color: "#b91c1c", fontWeight: 800 }}>
                {error}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void handleCreatePin()}
              disabled={submitting}
              style={{
                width: "100%",
                minHeight: 60,
                marginTop: 18,
                border: 0,
                borderRadius: 14,
                background: "#b91c1c",
                color: "#fff",
                fontSize: 20,
                fontWeight: 900,
                cursor: submitting ? "wait" : "pointer",
              }}
            >
              PINを設定する
            </button>
          </>
        ) : null}

        {phase === "unlock" ? (
          <>
            <p style={{ margin: "0 0 16px", lineHeight: 1.6 }}>
              管理者用PINを入力してください。
            </p>
            <input
              autoFocus
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={(event) => setPin(normalizePinInput(event.target.value))}
              maxLength={ADMIN_PIN_MAX_LENGTH}
              style={inputStyle}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleUnlock();
              }}
            />
            {error ? (
              <p role="alert" style={{ color: "#b91c1c", fontWeight: 800 }}>
                {error}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void handleUnlock()}
              disabled={submitting}
              style={{
                width: "100%",
                minHeight: 60,
                marginTop: 18,
                border: 0,
                borderRadius: 14,
                background: "#b91c1c",
                color: "#fff",
                fontSize: 20,
                fontWeight: 900,
                cursor: submitting ? "wait" : "pointer",
              }}
            >
              設定を開く
            </button>
          </>
        ) : null}

        {phase === "settings" ? (
          <section>
              <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 8 }}>
                19:00チェックデータ
              </div>
              <div
                style={{
                  color: "#475569",
                  fontSize: 14,
                  lineHeight: 1.6,
                  marginBottom: 12,
                }}
              >
                未出力：{review19UnexportedCount}回分
                <br />
                保存済み：{review19TotalCount}回分
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                <button
                  type="button"
                  onClick={onExportReview19Unexported}
                  disabled={review19UnexportedCount === 0}
                  style={{
                    width: "100%",
                    minHeight: 58,
                    border: 0,
                    borderRadius: 14,
                    background:
                      review19UnexportedCount === 0 ? "#e2e8f0" : "#b91c1c",
                    color: review19UnexportedCount === 0 ? "#94a3b8" : "#fff",
                    fontSize: 18,
                    fontWeight: 900,
                    cursor:
                      review19UnexportedCount === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  未出力データを出力
                </button>
                <button
                  type="button"
                  onClick={onExportAllReview19}
                  disabled={review19TotalCount === 0}
                  style={{
                    width: "100%",
                    minHeight: 52,
                    borderRadius: 14,
                    border: "1px solid #cbd5e1",
                    background: review19TotalCount === 0 ? "#f1f5f9" : "#fff",
                    color: review19TotalCount === 0 ? "#94a3b8" : "#0f172a",
                    fontSize: 16,
                    fontWeight: 800,
                    cursor: review19TotalCount === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  全データを出力
                </button>
              </div>
          </section>
        ) : null}
      </section>
    </div>
  );
}
