import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  appendPhotoGroup,
  createPhotoGroupId,
  ensureDataDirs,
  readPhotoGroups,
  saveUploadedFiles,
  updatePhotoGroup,
} from "./storage.js";
import { selectExamples } from "./selectExamples.js";
import { judgeWithOpenAI } from "./openaiJudge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const TMP_DIR = path.join(ROOT, "data", "tmp");

await ensureDataDirs();
await fs.mkdir(TMP_DIR, { recursive: true });

const app = express();

app.use((req, res, next) => {
  const origin = process.env.CORS_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

const maxPhotoMb = Number(process.env.MAX_PHOTO_MB || 25);

const upload = multer({
  dest: TMP_DIR,
  limits: {
    files: Number(process.env.MAX_PHOTOS || 6),
    fileSize: maxPhotoMb * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype?.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("画像ファイルだけアップロードできます。"));
    }
  },
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(ROOT, "public")));
app.use("/photos", express.static(path.join(ROOT, "data", "photos")));

function requireText(value, name) {
  const text = String(value ?? "").trim();
  if (!text) {
    const error = new Error(`${name} は必須です。`);
    error.statusCode = 400;
    throw error;
  }
  return text;
}


function normalizeActualWeekday(value) {
  const text = String(value ?? "").trim();
  const compact = text.replace(/\s+/g, "");
  const map = {
    日: "日曜日",
    日曜: "日曜日",
    日曜日: "日曜日",
    月: "月曜日",
    月曜: "月曜日",
    月曜日: "月曜日",
    火: "火曜日",
    火曜: "火曜日",
    火曜日: "火曜日",
    水: "水曜日",
    水曜: "水曜日",
    水曜日: "水曜日",
    木: "木曜日",
    木曜: "木曜日",
    木曜日: "木曜日",
    金: "金曜日",
    金曜: "金曜日",
    金曜日: "金曜日",
    土: "土曜日",
    土曜: "土曜日",
    土曜日: "土曜日",
  };
  return map[compact] || text;
}

function normalizeWeekdayBase(value, actualWeekday) {
  const text = String(value ?? "").trim();
  const compact = text
    .replace(/\s+/g, "")
    .replace(/曜日/g, "")
    .replace(/曜/g, "")
    .replace(/基準/g, "")
    .replace(/[･・\/／,，、]/g, "");

  if (compact === "日") return "日";
  if (compact === "金土" || compact === "金" || compact === "土") return "金・土";
  if (compact === "火木" || compact === "火" || compact === "木") return "火・木";
  if (compact === "月水" || compact === "月" || compact === "水") return "月・水";

  const normalizedActualWeekday = normalizeActualWeekday(actualWeekday);
  if (normalizedActualWeekday === "日曜日") return "日";
  if (normalizedActualWeekday === "金曜日" || normalizedActualWeekday === "土曜日") return "金・土";
  if (normalizedActualWeekday === "火曜日" || normalizedActualWeekday === "木曜日") return "火・木";
  if (normalizedActualWeekday === "月曜日" || normalizedActualWeekday === "水曜日") return "月・水";

  return text || "基準不明";
}


function normalizeSessionDate(value, fallbackIso) {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const fallbackText = String(fallbackIso ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(fallbackText)) return fallbackText.slice(0, 10);

  return new Date().toISOString().slice(0, 10);
}

function normalizeDiscountTimeKey(value) {
  const text = String(value ?? "").trim();
  if (/20/.test(text)) return "20";
  if (/19/.test(text)) return "19";
  if (/18/.test(text)) return "18";
  if (/17/.test(text)) return "17";
  if (/15/.test(text)) return "15";
  return null;
}

function previousDiscountTimeKey(value) {
  const key = normalizeDiscountTimeKey(value);
  switch (key) {
    case "17":
      return "15";
    case "18":
      return "17";
    case "19":
      return "18";
    case "20":
      return "19";
    default:
      return null;
  }
}

function getGroupSessionDate(group) {
  return normalizeSessionDate(group?.sessionDate || group?.date, group?.createdAt);
}

function getGroupDiscountTimeKey(group) {
  return group?.discountTimeKey || normalizeDiscountTimeKey(group?.discountTime);
}

function getGroupWeekdayBase(group) {
  return normalizeWeekdayBase(group?.weekdayBase || group?.weekday, group?.actualWeekday || group?.weekday);
}

function parsePhotoLabels(value, count) {
  if (!value) return Array.from({ length: count }, (_v, index) => `写真${index + 1}`);

  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) throw new Error("photoLabels must be an array");
    return Array.from({ length: count }, (_v, index) => {
      const label = String(parsed[index] ?? "").trim();
      return label || `写真${index + 1}`;
    });
  } catch {
    return Array.from({ length: count }, (_v, index) => `写真${index + 1}`);
  }
}

function timeoutAiResult(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        suggestion: null,
        confidence: "低",
        reason: ["AI判定が時間内に終わりませんでした。売場を見て選択してください。"],
        raw: null,
        skipped: true,
      });
    }, milliseconds);
  });
}

async function judgeWithTimeout(params) {
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS || 45000);
  try {
    return await Promise.race([
      judgeWithOpenAI(params),
      timeoutAiResult(timeoutMs),
    ]);
  } catch (error) {
    return {
      suggestion: null,
      confidence: "低",
      reason: [
        error instanceof Error
          ? `AI判定に失敗しました。${error.message}`
          : "AI判定に失敗しました。売場を見て選択してください。",
      ],
      raw: error instanceof Error ? error.stack || error.message : String(error),
      skipped: true,
    };
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/recent", async (_req, res, next) => {
  try {
    const groups = await readPhotoGroups();
    res.json({
      groups: groups
        .slice()
        .reverse()
        .slice(0, 20)
        .map((group) => ({
          id: group.id,
          area: group.area,
          weekday: group.weekday,
          actualWeekday: group.actualWeekday,
          weekdayBase: group.weekdayBase,
          sessionDate: getGroupSessionDate(group),
          discountTime: group.discountTime,
          discountTimeKey: getGroupDiscountTimeKey(group),
          aiJudge: group.aiJudge,
          aiConfidence: group.aiConfidence,
          humanJudge: group.humanJudge,
          feedbackText: group.feedbackText,
          createdAt: group.createdAt,
          photoCount: group.photoPaths?.length ?? 0,
        })),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/judge", upload.array("photos", Number(process.env.MAX_PHOTOS || 6)), async (req, res, next) => {
  try {
    const area = requireText(req.body.area, "エリア");
    const actualWeekday = normalizeActualWeekday(
      requireText(req.body.actualWeekday || req.body.weekday, "実際の曜日")
    );
    const weekdayBase = normalizeWeekdayBase(req.body.weekdayBase || req.body.weekday, actualWeekday);
    const discountTime = requireText(req.body.discountTime, "時刻");
    const discountTimeKey = normalizeDiscountTimeKey(discountTime);
    const files = req.files ?? [];

    if (files.length === 0) {
      const error = new Error("写真を1枚以上選んでください。");
      error.statusCode = 400;
      throw error;
    }

    const photoLabels = parsePhotoLabels(req.body.photoLabels, files.length);
    const id = createPhotoGroupId();
    const savedResult = await saveUploadedFiles({
      photoGroupId: id,
      area,
      weekdayBase,
      discountTime,
      files,
      photoLabels,
    });
    const savedPhotos = savedResult.saved;
    const createdAt = new Date().toISOString();
    const sessionDate = normalizeSessionDate(req.body.sessionDate || req.body.date, createdAt);

    const currentGroup = {
      id,
      area,
      weekday: actualWeekday,
      actualWeekday,
      weekdayBase,
      sessionDate,
      discountTime,
      discountTimeKey,
      photoDir: savedResult.relativeDir,
      photoPaths: savedPhotos.map((photo) => photo.relativePath),
      photoLabels: savedPhotos.map((photo) => photo.label),
      aiJudge: null,
      aiConfidence: null,
      aiReason: [],
      humanJudge: null,
      createdAt,
      updatedAt: createdAt,
    };

    const groups = await readPhotoGroups();
    const examples = selectExamples(groups, {
      area,
      actualWeekday,
      weekdayBase,
      discountTime,
      currentId: id,
    });

    const aiResult = await judgeWithTimeout({
      currentGroup,
      currentPhotos: savedPhotos,
      examples,
    });

    const storedGroup = {
      ...currentGroup,
      aiJudge: aiResult.suggestion,
      aiConfidence: aiResult.confidence,
      aiReason: aiResult.reason,
      aiRaw: aiResult.raw,
      aiSkipped: aiResult.skipped,
      exampleGroupIds: examples.map((group) => group.id),
    };

    await appendPhotoGroup(storedGroup);

    res.json({
      photoGroupId: id,
      suggestion: aiResult.suggestion,
      confidence: aiResult.confidence,
      reason: aiResult.reason,
      aiSkipped: aiResult.skipped,
      examples: examples.map((group) => ({
        id: group.id,
        area: group.area,
        weekday: group.weekday,
        actualWeekday: group.actualWeekday,
        weekdayBase: group.weekdayBase,
        sessionDate: getGroupSessionDate(group),
        discountTime: group.discountTime,
        discountTimeKey: getGroupDiscountTimeKey(group),
        humanJudge: group.humanJudge,
        photoCount: group.photoPaths?.length ?? 0,
      })),
    });
  } catch (error) {
    next(error);
  }
});


function feedbackFromNextJudge(humanJudge) {
  switch (humanJudge) {
    case "多い":
      return { code: "weak", text: "前回のエリア判定は弱かった可能性" };
    case "どちらでもない":
      return { code: "good", text: "前回のエリア判定はちょうどよかった可能性" };
    case "少ない":
      return { code: "strong", text: "前回のエリア判定は強かった可能性" };
    default:
      return null;
  }
}

function findPreviousFeedbackTarget(groups, currentGroup) {
  const currentSessionDate = getGroupSessionDate(currentGroup);
  const currentDiscountTimeKey = getGroupDiscountTimeKey(currentGroup);
  const targetDiscountTimeKey = previousDiscountTimeKey(currentDiscountTimeKey);
  const currentWeekdayBase = getGroupWeekdayBase(currentGroup);
  const currentCreatedAt = Date.parse(currentGroup.createdAt || "");

  if (!currentSessionDate || !targetDiscountTimeKey) return null;

  return groups
    .filter((group) => {
      if (group.id === currentGroup.id) return false;
      if (group.area !== currentGroup.area) return false;
      if (getGroupSessionDate(group) !== currentSessionDate) return false;
      if (getGroupWeekdayBase(group) !== currentWeekdayBase) return false;
      if (getGroupDiscountTimeKey(group) !== targetDiscountTimeKey) return false;
      if (!group.humanJudge) return false;
      if (group.feedbackFromNextJudge) return false;
      const createdAt = Date.parse(group.createdAt || "");
      if (Number.isNaN(createdAt)) return false;
      if (!Number.isNaN(currentCreatedAt) && createdAt >= currentCreatedAt) return false;
      return true;
    })
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))[0] ?? null;
}

app.post("/api/feedback", async (req, res, next) => {
  try {
    const photoGroupId = requireText(req.body.photoGroupId, "photoGroupId");
    const humanJudge = requireText(req.body.humanJudge, "humanJudge");
    if (!["多い", "どちらでもない", "少ない"].includes(humanJudge)) {
      const error = new Error("humanJudge は 多い / どちらでもない / 少ない のいずれかです。");
      error.statusCode = 400;
      throw error;
    }

    const now = new Date().toISOString();
    const updated = await updatePhotoGroup(photoGroupId, (group) => ({
      ...group,
      humanJudge,
      updatedAt: now,
    }));

    if (!updated) {
      const error = new Error("対象の写真セットが見つかりません。");
      error.statusCode = 404;
      throw error;
    }

    let feedbackTarget = null;
    const feedback = feedbackFromNextJudge(humanJudge);
    if (feedback) {
      const groups = await readPhotoGroups();
      const target = findPreviousFeedbackTarget(groups, updated);
      if (target) {
        feedbackTarget = await updatePhotoGroup(target.id, (group) => ({
          ...group,
          feedbackFromNextJudge: feedback.code,
          feedbackText: feedback.text,
          feedbackNextJudge: humanJudge,
          feedbackNextPhotoGroupId: updated.id,
          feedbackSessionDate: getGroupSessionDate(updated),
          feedbackTargetDiscountTimeKey: getGroupDiscountTimeKey(group),
          feedbackNextDiscountTimeKey: getGroupDiscountTimeKey(updated),
          feedbackUpdatedAt: now,
          updatedAt: now,
        }));
      }
    }

    res.json({ ok: true, group: updated, feedbackTarget });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);

  if (error instanceof multer.MulterError) {
    const statusCode = 400;
    if (error.code === "LIMIT_FILE_SIZE") {
      res.status(statusCode).json({
        error: `写真が大きすぎます。1枚${maxPhotoMb}MB以下にしてください。`,
      });
      return;
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      res.status(statusCode).json({
        error: "一度に送れる写真枚数が上限を超えています。",
      });
      return;
    }
  }

  res.status(error.statusCode || 500).json({
    error: error.message || "サーバーエラーが発生しました。",
  });
});

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);

app.listen(port, host, () => {
  console.log(`nebiki-photo-judge: http://${host}:${port}`);
});
