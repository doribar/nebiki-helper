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
    `過去適切例${index + 1}`,
    `エリア:${group.area}`,
    `曜日基準:${group.weekdayBase || group.weekday}`,
    group.actualWeekday || group.weekday ? `実際曜日:${group.actualWeekday || group.weekday}` : null,
    `時刻:${group.discountTime}`,
    `この過去例で人間が選んだ判定:${group.humanJudge}`,
    group.feedbackText
      ? `次回値引による評価:${group.feedbackText}`
      : "次回値引による評価:適切だった可能性",
  ].filter(Boolean).join(" / ");
}

function clampExamplePhotoPaths(group) {
  const max = Number(process.env.MAX_EXAMPLE_PHOTOS_PER_GROUP || 6);
  const limit = Number.isFinite(max) && max > 0 ? max : 6;
  return (group.photoPaths || []).slice(0, limit);
}

function buildInstructionText({ currentGroup, hasExamples }) {
  const baseLines = [
    "これは惣菜・弁当売場の値引判断を補助するための画像判定です。",
    "今回写真セットは同じエリアの別角度・別部分を含む場合があります。写真を別エリアとして扱わず、エリア全体として判断してください。",
    "出力する判定は、人間が最終選択する前の参考判定です。必ずJSONスキーマに従ってください。",
    "判定は 多い / どちらでもない / 少ない の3択です。",
    "比較では、単純な見た目の類似だけでなく、撮影角度や距離、写真に写っている売場幅、商品の積み重なり方、空きスペース、商品密度、広く薄く残っているのか狭く厚く残っているのかを考慮してください。",
    "",
    `今回条件: エリア=${currentGroup.area} / 曜日基準=${currentGroup.weekdayBase || currentGroup.weekday} / 実際曜日=${currentGroup.actualWeekday || currentGroup.weekday} / 時刻=${currentGroup.discountTime}`,
  ];

  if (hasExamples) {
    return [
      ...baseLines,
      "",
      "このあと、過去に適切だった写真セットと今回写真セットを見せます。",
      "過去適切例とは、過去に人間が 多い / どちらでもない / 少ない のいずれかを選び、その次の値引で同じエリアが どちらでもない になったため、結果的にちょうどよかった可能性がある例です。",
      "過去適切例の判定は どちらでもない とは限りません。多い も 少ない もあります。",
      "今回写真が過去適切例と同じ判定として扱えそうなら、その過去例の判定を参考にしてください。",
      "今回の方が過去適切例より残量・密度・積み上がりが多そうなら、多い寄りへ補正してください。今回の方が少なそうなら、少ない寄りへ補正してください。",
      "過去例と構図や売場幅が違う場合は、その違いを補正して判断してください。",
      "理由には、どの過去例の判定を参考にしたか、またはなぜ補正したかを短く含めてください。",
    ].join("\n");
  }

  return [
    ...baseLines,
    "",
    "同じ曜日基準・同じ時刻・同じエリアで、次回値引により適切だったと確認済みの過去例はまだありません。",
    "今回は今回写真だけから、幅、奥行き、商品の重なり、空き具合、手前だけ/奥まで残っているかを見て、控えめに参考判定を返してください。",
  ].join("\n");
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

  const timeoutMs = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || process.env.AI_TIMEOUT_MS || 180000);
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 180000,
    maxRetries: 1,
  });
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";

  const content = [
    {
      type: "input_text",
      text: buildInstructionText({
        currentGroup,
        hasExamples: examples.length > 0,
      }),
    },
  ];

  if (examples.length > 0) {
    content.push({
      type: "input_text",
      text: "以下が、同じ曜日基準・同じ時刻・同じエリアから選んだ過去適切例です。各例は写真セット単位です。",
    });

    for (let i = 0; i < examples.length; i += 1) {
      const group = examples[i];
      content.push({ type: "input_text", text: groupLabel(group, i) });
      const photoPaths = clampExamplePhotoPaths(group);
      for (let j = 0; j < photoPaths.length; j += 1) {
        const label = group.photoLabels?.[j] || `写真${j + 1}`;
        content.push({ type: "input_text", text: `過去適切例${i + 1} ${label}` });
        content.push(await toImageContentItem(dataPath(photoPaths[j])));
      }
    }
  }

  content.push({
    type: "input_text",
    text: "以下が今回写真セットです。過去適切例がある場合は、それと比較して今回の参考判定を出してください。",
  });

  for (let i = 0; i < currentPhotos.length; i += 1) {
    content.push({ type: "input_text", text: `今回写真 ${i + 1}: ${currentPhotos[i].label || "写真"}` });
    content.push(await toImageContentItem(currentPhotos[i].absolutePath));
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
    max_output_tokens: 500,
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
