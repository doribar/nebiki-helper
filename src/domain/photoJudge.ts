import type { AreaJudge } from "./types";

const STORAGE_KEY = "nebiki-photo-judge-api-base-url";
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";

export type PhotoJudgeSuggestion = "多い" | "どちらでもない" | "少ない" | null;
export type PhotoJudgeConfidence = "低" | "中" | "高" | null;

export type PhotoJudgeResult = {
  photoGroupId: string;
  suggestion: PhotoJudgeSuggestion;
  confidence: PhotoJudgeConfidence;
  reason: string[];
  aiSkipped?: boolean;
};

export function getPhotoJudgeBaseUrl(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored?.trim() || DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

export function setPhotoJudgeBaseUrl(url: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, url.trim() || DEFAULT_BASE_URL);
  } catch {
    // localStorage が使えない環境では保存しない
  }
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.error === "string") return body.error;
  } catch {
    // JSONでない場合は下の汎用文言を返す
  }

  return `写真判定サーバーがエラーを返しました。(${response.status})`;
}

export async function requestPhotoJudge(params: {
  apiBaseUrl: string;
  areaName: string;
  weekdayText: string;
  timeText: string;
  photos: File[];
}): Promise<PhotoJudgeResult> {
  if (params.photos.length === 0) {
    throw new Error("写真を1枚以上選んでください。");
  }

  const form = new FormData();
  form.append("area", params.areaName);
  form.append("weekday", params.weekdayText);
  form.append("discountTime", params.timeText);
  for (const photo of params.photos) {
    form.append("photos", photo);
  }

  const response = await fetch(`${trimTrailingSlash(params.apiBaseUrl)}/api/judge`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const body = await response.json();
  return {
    photoGroupId: String(body.photoGroupId ?? ""),
    suggestion:
      body.suggestion === "多い" || body.suggestion === "どちらでもない" || body.suggestion === "少ない"
        ? body.suggestion
        : null,
    confidence:
      body.confidence === "低" || body.confidence === "中" || body.confidence === "高"
        ? body.confidence
        : null,
    reason: Array.isArray(body.reason)
      ? body.reason.map((line: unknown) => String(line)).filter(Boolean)
      : [],
    aiSkipped: Boolean(body.aiSkipped),
  };
}

export function areaJudgeToHumanText(judge: Exclude<AreaJudge, null>): "多い" | "どちらでもない" | "少ない" {
  switch (judge) {
    case "many":
      return "多い";
    case "normal":
      return "どちらでもない";
    case "few":
      return "少ない";
  }
}

export async function sendPhotoJudgeFeedback(params: {
  apiBaseUrl: string;
  photoGroupId: string;
  humanJudge: "多い" | "どちらでもない" | "少ない";
}): Promise<void> {
  if (!params.photoGroupId) return;

  const response = await fetch(`${trimTrailingSlash(params.apiBaseUrl)}/api/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      photoGroupId: params.photoGroupId,
      humanJudge: params.humanJudge,
    }),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }
}
