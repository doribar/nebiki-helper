import { PrimaryButton } from "../layout/PrimaryButton";

function JudgeHintContent({
  compact = false,
  showSummerModeJudgeHint = false,
}: {
  compact?: boolean;
  showSummerModeJudgeHint?: boolean;
}) {
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
        15時：2つの間で迷う場合は選択肢を長押し。
        <br />中間評価として記録し、値引率は
        <span style={{ color: "#e65100", fontWeight: 700 }}>
          少ない側の判定
        </span>
        で計算します。
      </div>
      {!showSummerModeJudgeHint ? (
        <div style={{ marginTop: 8 }}>
          17時以降：2つの間で迷う場合は選択肢を長押し。
          <br />中間評価として記録し、値引率は
          <span style={{ color: "#e65100", fontWeight: 700 }}>
            多い側の判定
          </span>
          で計算します。
        </div>
      ) : null}
      {showSummerModeJudgeHint ? (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            border: "1px solid #f59e0b",
            borderRadius: 10,
            background: "#fffbeb",
            color: "#78350f",
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 900 }}>夏季モード中（17:59まで）</div>
          <div>
            残数判定で2つの間に迷う場合は選択肢を長押し。隣の項目を選ぶと中間評価として記録し、値引率は少ない側の判定で計算します。
          </div>
          <div>
            明らかに多い場合は無理に下げず、夕方〜夜の売れ方も考慮して個別に判断します。
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function JudgeHintDialog({
  onClose,
  compact = false,
  showSummerModeJudgeHint = false,
}: {
  onClose: () => void;
  compact?: boolean;
  showSummerModeJudgeHint?: boolean;
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

        <JudgeHintContent
          compact={compact}
          showSummerModeJudgeHint={showSummerModeJudgeHint}
        />

        <div style={{ marginTop: 18 }}>
          <PrimaryButton onClick={onClose}>OK</PrimaryButton>
        </div>
      </div>
    </div>
  );
}
