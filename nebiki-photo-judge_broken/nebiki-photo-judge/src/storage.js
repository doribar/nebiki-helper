import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const PHOTO_DIR = path.join(DATA_DIR, "photos");
const JSONL_PATH = path.join(DATA_DIR, "photo-groups.jsonl");

export async function ensureDataDirs() {
  await fs.mkdir(PHOTO_DIR, { recursive: true });
  try {
    await fs.access(JSONL_PATH);
  } catch {
    await fs.writeFile(JSONL_PATH, "", "utf8");
  }
}

export function sanitizeSegment(value) {
  return String(value ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "unknown";
}

export function createPhotoGroupId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "_",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${stamp}_${rand}`;
}

export function createPhotoGroupRelativeDir({ discountTime, weekdayBase, area, photoGroupId }) {
  return [
    "photos",
    sanitizeSegment(discountTime || "time"),
    sanitizeSegment(weekdayBase || "weekday_base"),
    sanitizeSegment(area || "area"),
    sanitizeSegment(photoGroupId || createPhotoGroupId()),
  ].join("/");
}

function buildPhotoFilename({ index, label, originalname }) {
  const originalExt = path.extname(originalname || "").toLowerCase();
  const ext = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"].includes(originalExt)
    ? originalExt
    : ".jpg";
  const number = String(index + 1).padStart(2, "0");
  const labelPart = sanitizeSegment(label || `写真${index + 1}`);
  return `${number}_${labelPart}${ext}`;
}

export async function saveUploadedFiles({ photoGroupId, area, weekdayBase, discountTime, files, photoLabels }) {
  const relativeDir = createPhotoGroupRelativeDir({
    discountTime,
    weekdayBase,
    area,
    photoGroupId,
  });
  const dir = path.join(DATA_DIR, relativeDir);
  await fs.mkdir(dir, { recursive: true });

  const saved = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const label = photoLabels?.[i] || `写真${i + 1}`;
    const filename = buildPhotoFilename({
      index: i,
      label,
      originalname: file.originalname,
    });
    const absolutePath = path.join(dir, filename);
    await fs.rename(file.path, absolutePath);
    saved.push({
      filename,
      label,
      relativePath: path.relative(DATA_DIR, absolutePath).replaceAll("\\", "/"),
      absolutePath,
      mimeType: file.mimetype,
      size: file.size,
    });
  }
  return { relativeDir, saved };
}

export async function readPhotoGroups() {
  await ensureDataDirs();
  const raw = await fs.readFile(JSONL_PATH, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function appendPhotoGroup(group) {
  await ensureDataDirs();
  await fs.appendFile(JSONL_PATH, `${JSON.stringify(group)}\n`, "utf8");
  await writePhotoGroupMeta(group);
}

export async function writePhotoGroupMeta(group) {
  if (!group.photoDir) return;
  const dir = path.join(DATA_DIR, group.photoDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "meta.json"), `${JSON.stringify(group, null, 2)}\n`, "utf8");
}

export async function updatePhotoGroup(id, updater) {
  const groups = await readPhotoGroups();
  let updatedGroup = null;
  const next = groups.map((group) => {
    if (group.id !== id) return group;
    updatedGroup = updater({ ...group });
    return updatedGroup;
  });
  await fs.writeFile(
    JSONL_PATH,
    next.map((group) => JSON.stringify(group)).join("\n") + (next.length ? "\n" : ""),
    "utf8",
  );
  if (updatedGroup) {
    await writePhotoGroupMeta(updatedGroup);
  }
  return updatedGroup;
}

export function dataPath(relativePath) {
  return path.join(DATA_DIR, relativePath);
}
