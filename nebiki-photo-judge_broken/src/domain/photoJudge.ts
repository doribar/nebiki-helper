import type { AreaJudge } from "./types";

const STORAGE_KEY = "nebiki-photo-judge-api-base-url";
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const PHOTO_JUDGE_REQUEST_TIMEOUT_MS = 180000;

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


export function createPhotoObjectPreviewUrl(file: File): string | undefined {
  if (!file.type.startsWith("image/")) return undefined;
  return URL.createObjectURL(file);
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function createTimeoutSignal(milliseconds: number): AbortSignal {
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
}

function normalizeFetchError(error: unknown): Error {
  if (error instanceof DOMException && error.name === "AbortError") {
    return new Error("写真判定サーバーの応答が3分以内に返りませんでした。写真判定サーバー側の AI_TIMEOUT_MS、Tailscale接続、写真枚数を確認してください。");
  }

  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return new Error("写真判定サーバーに接続できませんでした。URL、Tailscale接続、写真判定サーバーの起動状態を確認してください。");
  }

  return error instanceof Error ? error : new Error("写真判定でエラーが発生しました。");
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


export async function compressPhotoForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  const originalSize = file.size;
  const objectUrl = URL.createObjectURL(file);

  let image: HTMLImageElement | null = null;
  let canvas: HTMLCanvasElement | null = null;

  try {
    image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("画像の読み込みに失敗しました。"));
      img.src = objectUrl;
    });

    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;
    const longest = Math.max(sourceWidth, sourceHeight);

    if (!sourceWidth || !sourceHeight || !longest) {
      throw new Error("画像サイズを読み取れませんでした。");
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
    const attempts = [
      { maxSide: 960, quality: 0.64 },
      { maxSide: 800, quality: 0.58 },
      { maxSide: 640, quality: 0.54 },
    ];

    let bestBlob: Blob | null = null;

    for (const attempt of attempts) {
      const scale = Math.min(1, attempt.maxSide / longest);
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));

      canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) {
        throw new Error("画像の圧縮準備に失敗しました。");
      }

      context.drawImage(image, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas?.toBlob(resolve, "image/jpeg", attempt.quality);
      });

      canvas.width = 0;
      canvas.height = 0;
      canvas = null;

      if (!blob) continue;
      bestBlob = blob;

      if (blob.size <= 450 * 1024) break;
    }

    if (!bestBlob) {
      throw new Error("画像の圧縮に失敗しました。");
    }

    if (originalSize <= 450 * 1024 && originalSize <= bestBlob.size) {
      return file;
    }

    return new File([bestBlob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    // 端末によっては、高解像度写真を canvas に展開する時点でメモリ不足になる。
    // その場合でも撮影フローを止めないよう、圧縮を諦めて元ファイルを保持・送信する。
    return file;
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    URL.revokeObjectURL(objectUrl);
  }
}

export async function requestPhotoJudge(params: {
  apiBaseUrl: string;
  areaName: string;
  weekdayText: string;
  weekdayBaseText: string;
  timeText: string;
  sessionDate: string;
  photos: File[];
  photoLabels?: string[];
}): Promise<PhotoJudgeResult> {
  if (params.photos.length === 0) {
    throw new Error("写真を1枚以上選んでください。");
  }

  const form = new FormData();
  form.append("area", params.areaName);
  form.append("weekday", params.weekdayText);
  form.append("actualWeekday", params.weekdayText);
  form.append("weekdayBase", params.weekdayBaseText);
  form.append("discountTime", params.timeText);
  form.append("sessionDate", params.sessionDate);
  for (const photo of params.photos) {
    form.append("photos", photo);
  }
  if (params.photoLabels?.length) {
    form.append("photoLabels", JSON.stringify(params.photoLabels));
  }

  let response: Response;
  try {
    response = await fetch(`${trimTrailingSlash(params.apiBaseUrl)}/api/judge`, {
      method: "POST",
      body: form,
      signal: createTimeoutSignal(PHOTO_JUDGE_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw normalizeFetchError(error);
  }

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

  let response: Response;
  try {
    response = await fetch(`${trimTrailingSlash(params.apiBaseUrl)}/api/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        photoGroupId: params.photoGroupId,
        humanJudge: params.humanJudge,
      }),
      signal: createTimeoutSignal(30000),
    });
  } catch (error) {
    throw normalizeFetchError(error);
  }

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }
}
