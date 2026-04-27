import type { ReactNode, Ref } from "react";

type PrimaryButtonProps = {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
};

export function PrimaryButton({
  children,
  onClick,
  disabled = false,
  buttonRef,
}: PrimaryButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        padding: "14px 16px",
        borderRadius: 12,
        border: "1px solid #ccc",
        background: disabled ? "#eee" : "#fff",
        fontSize: 16,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}