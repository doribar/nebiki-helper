import { PrimaryButton } from "../layout/PrimaryButton";

function JudgeHintContent({ compact = false }: { compact?: boolean }) {
  return (
    <div style={{ lineHeight: 1.8 }}>
      {!compact ? (
        <>
          <div>
            ・アウトパック
            <span style={{ color: "#00897b", fontWeight: 700 }}>
              ➡多い側に寄せる
            </span>
          </div>
          <div>
            ・商品が大パックと小パックで分かれている
            <span style={{ color: "#ab47bc", fontWeight: 700 }}>
              ➡大パックだけ値引
            </span>
          </div>
          <div>
            ・期限が近いものと遠いもので分かれている
            <span style={{ color: "#ab47bc", fontWeight: 700 }}>
              ➡近いものだけ値引
            </span>
          </div>

          <div style={{ marginTop: 14, marginBottom: 8 }}>
            ・分かれていなければ値引時刻が
          </div>
        </>
      ) : null}
      <div>
        15時
        <span style={{ color: "#e65100", fontWeight: 700 }}>
          ➡少ない側に寄せる
        </span>
        <span style={{ color: "#666", fontSize: 13 }}>
          （品揃え確保優先）
        </span>
      </div>
      <div>
        17時以降
        <span style={{ color: "#e65100", fontWeight: 700 }}>
          ➡多い側に寄せる
        </span>
        <span style={{ color: "#666", fontSize: 13 }}>
          （売り切り優先）
        </span>
      </div>
    </div>
  );
}

export function JudgeHintDialog({
  onClose,
  compact = false,
}: {
  onClose: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="judge-hint-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0, 0, 0, 0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: 16,
          background: "#fff",
          padding: 18,
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.25)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          id="judge-hint-title"
          style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}
        >
          迷った時の判断基準
        </div>

        <JudgeHintContent compact={compact} />

        <div style={{ marginTop: 18 }}>
          <PrimaryButton onClick={onClose}>OK</PrimaryButton>
        </div>
      </div>
    </div>
  );
}
