export type CalculatorDraft = {
  text: string;
  open: boolean;
};

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function buildCalculatorDraftKey(params: {
  kind: "area-count" | "review19-count";
  scopeId: string;
  areaId: string;
}): string {
  return `nebiki-helper:calculator-draft:${params.kind}:${params.scopeId}:${params.areaId}`;
}

export function loadCalculatorDraft(key: string): CalculatorDraft | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CalculatorDraft>;
    if (typeof parsed.text !== "string" || typeof parsed.open !== "boolean") {
      storage.removeItem(key);
      return null;
    }

    return {
      text: parsed.text,
      open: parsed.open,
    };
  } catch {
    return null;
  }
}

export function saveCalculatorDraft(key: string, draft: CalculatorDraft): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(key, JSON.stringify(draft));
  } catch {
    // 保存できない環境では、その場の入力だけで動作を続ける。
  }
}

export function clearCalculatorDraft(key: string): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.removeItem(key);
  } catch {
    // 削除できない環境でも画面操作は継続する。
  }
}
