import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { dataPath } from "./storage.js";

const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestion: {
      type: "string",
      enum: ["多い", "どちらでもない", "少ない"],
      description: "今回写真セットに対する参考判定",
    },
    confidence: {
      type: "string",
      enum: ["低", "中", "高"],
      description: "参考判定の自信度",
    },
    reason: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: { type: "string" },
      description: "現場で読める短い理由。各文は長くしすぎない。",
    },
  },
  required: ["suggestion", "confidence", "reason"],
};

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".heic" || ext === ".heif") return "image/heic";
  return "image/jpeg";
}

async function toImageContentItem(filePath) {
  const base64 = await fs.readFile(filePath, "base64");
  return {
    type: "input_image",
    image_url: `data:${mimeFromPath(filePath)};base64,${base64}`,
  };
}

function groupLabel(group, index) {
  return [
    `過去例${index + 1}`,
    `エリア:${group.area}`,
    `曜日基準:${group.weekdayBase || group.weekday}`,
    group.actualWeekday || group.weekday ? `実際曜日:${group.actualWeekday || group.weekday}` : null,
    `時刻:${group.discountTime}`,
    `人間判定:${group.humanJudge}`,
    group.feedbackText ? `前回評価:${group.feedbackText}` : "前回評価:未評価",
  ].filter(Boolean).join(" / ");
}

export async function judgeWithOpenAI({ currentGroup, currentPhotos, examples }) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      suggestion: null,
      confidence: "低",
      reason: ["OPENAI_API_KEY が未設定のため、AI参考判定は行っていません。写真と最終判定の保存だけ可能です。"],
      raw: null,
      skipped: true,
    };
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const content = [
    {
      type: "input_text",
      text: [
        "これは惣菜・弁当売場の値引判断を補助するための画像判定です。",
        "今回写真セットは同じエリアの別角度・別部分を含む場合があります。写真を別エリアとして扱わず、全体として判断してください。",
        "過去例には、この店で人間が最終的に選んだ判定が付いています。",
        "幅、奥行き、商品の重なり、空き具合、手前だけ/奥まで残っているかを考慮してください。",
        "最終判断ではなく参考判定です。結果は必ずJSONスキーマに従ってください。",
        "",
        `今回条件: エリア=${currentGroup.area} / 曜日基準=${currentGroup.weekdayBase || currentGroup.weekday} / 実際曜日=${currentGroup.actualWeekday || currentGroup.weekday} / 時刻=${currentGroup.discountTime}`,
        "以下が今回写真セットです。",
      ].join("\n"),
    },
  ];

  for (let i = 0; i < currentPhotos.length; i += 1) {
    content.push({ type: "input_text", text: `今回写真 ${i + 1}: ${currentPhotos[i].label || "写真"}` });
    content.push(await toImageContentItem(currentPhotos[i].absolutePath));
  }

  if (examples.length > 0) {
    content.push({
      type: "input_text",
      text: "以下は同じエリアの過去例です。各過去例の人間判定を基準として参考にしてください。",
    });

    for (let i = 0; i < examples.length; i += 1) {
      const group = examples[i];
      content.push({ type: "input_text", text: groupLabel(group, i) });
      const photoPaths = (group.photoPaths || []).slice(0, 3);
      for (let j = 0; j < photoPaths.length; j += 1) {
        const label = group.photoLabels?.[j] || `写真${j + 1}`;
        content.push({ type: "input_text", text: `過去例${i + 1} ${label}` });
        content.push(await toImageContentItem(dataPath(photoPaths[j])));
      }
    }
  } else {
    content.push({
      type: "input_text",
      text: "同じエリアの過去例はまだありません。今回写真だけから、理由と自信度を控えめに返してください。",
    });
  }

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "user",
        content,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "nebiki_area_judge",
        strict: true,
        schema: JUDGE_SCHEMA,
      },
    },
    max_output_tokens: 400,
  });

  let parsed;
  try {
    parsed = JSON.parse(response.output_text);
  } catch {
    parsed = {
      suggestion: "どちらでもない",
      confidence: "低",
      reason: ["AIの返答をJSONとして解析できませんでした。"],
    };
  }

  return {
    suggestion: parsed.suggestion,
    confidence: parsed.confidence,
    reason: parsed.reason,
    raw: response.output_text,
    skipped: false,
  };
}
