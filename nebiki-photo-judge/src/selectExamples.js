const JUDGES = ["多い", "どちらでもない", "少ない"];

function normalizeText(value) {
  return String(value ?? "").trim();
}

function getWeekdayBase(group) {
  return normalizeText(group.weekdayBase || group.weekday);
}

function getActualWeekday(group) {
  return normalizeText(group.actualWeekday || group.weekday);
}

function normalizeDiscountTimeKey(value) {
  const text = normalizeText(value);
  if (/20/.test(text)) return "20";
  if (/19/.test(text)) return "19";
  if (/18/.test(text)) return "18";
  if (/17/.test(text)) return "17";
  if (/15/.test(text)) return "15";
  return null;
}

function getDiscountTimeKey(group) {
  return group.discountTimeKey || normalizeDiscountTimeKey(group.discountTime);
}

function getTargetExampleLimit(area) {
  const text = normalizeText(area);
  if (text === "弁当・麺類" || text.includes("弁当・麺類")) return 1;
  if (text === "フライ・鶏惣菜" || text.includes("フライ・鶏惣菜")) return 2;
  return 3;
}

function createdAtMs(group) {
  const t = Date.parse(group.createdAt || "");
  return Number.isNaN(t) ? 0 : t;
}

function scoreGoodExample(group, context) {
  let score = 0;

  // 同じ条件の適切例を優先する。filter 側でも絞るが、古いデータへの保険として残す。
  if (group.area === context.area) score += 100;
  if (getDiscountTimeKey(group) === normalizeDiscountTimeKey(context.discountTime)) score += 30;
  if (getWeekdayBase(group) === normalizeText(context.weekdayBase)) score += 30;
  if (getActualWeekday(group) && getActualWeekday(group) === normalizeText(context.actualWeekday)) score += 3;

  // 次回値引で「どちらでもない」になった例を最重要視する。
  if (group.feedbackFromNextJudge === "good") score += 50;

  // 新しいデータを少し優先。
  const t = createdAtMs(group);
  if (t) score += Math.min(5, t / 1000000000000);

  return score;
}

function isGoodExample(group, context) {
  if (group.id === context.currentId) return false;
  if (group.area !== context.area) return false;
  if (!group.humanJudge || !JUDGES.includes(group.humanJudge)) return false;
  if (group.feedbackFromNextJudge !== "good") return false;
  if (!Array.isArray(group.photoPaths) || group.photoPaths.length === 0) return false;

  const groupTimeKey = getDiscountTimeKey(group);
  const contextTimeKey = normalizeDiscountTimeKey(context.discountTime);
  if (groupTimeKey && contextTimeKey && groupTimeKey !== contextTimeKey) return false;

  const groupWeekdayBase = getWeekdayBase(group);
  const contextWeekdayBase = normalizeText(context.weekdayBase);
  if (groupWeekdayBase && contextWeekdayBase && groupWeekdayBase !== contextWeekdayBase) return false;

  return true;
}

/**
 * 現在のAI判定に添える「過去の適切だった写真セット」を選ぶ。
 *
 * 適切だった例とは、過去に人間が 多い/どちらでもない/少ない のいずれかを選び、
 * 次の値引時刻で同じエリアが「どちらでもない」になったため、
 * その過去判定がちょうどよかった可能性がある写真セットを指す。
 *
 * 取得件数は写真枚数ではなく「写真セット数」。
 * - 弁当・麺類: 1セット
 * - フライ・鶏惣菜: 2セット
 * - その他: 3セット
 */
export function selectExamples(groups, context) {
  const limit = getTargetExampleLimit(context.area);

  return groups
    .filter((group) => isGoodExample(group, context))
    .sort((a, b) => scoreGoodExample(b, context) - scoreGoodExample(a, context))
    .slice(0, limit);
}

export function getExampleLimitForArea(area) {
  return getTargetExampleLimit(area);
}
