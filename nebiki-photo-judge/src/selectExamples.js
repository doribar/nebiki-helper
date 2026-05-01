const JUDGES = ["多い", "どちらでもない", "少ない"];

function timeScore(a, b) {
  if (!a || !b) return 0;
  return a === b ? 6 : 0;
}

function weekdayBaseScore(a, b) {
  if (!a || !b) return 0;
  return a === b ? 6 : 0;
}

function actualWeekdayScore(a, b) {
  if (!a || !b) return 0;
  return a === b ? 1 : 0;
}

function scoreGroup(group, context) {
  let score = 0;
  if (group.area === context.area) score += 100;
  score += timeScore(group.discountTime, context.discountTime);
  score += weekdayBaseScore(group.weekdayBase || group.weekday, context.weekdayBase);
  score += actualWeekdayScore(group.actualWeekday || group.weekday, context.actualWeekday);
  if (group.humanJudge) score += 5;
  if (group.feedbackFromNextJudge === "good") score += 2;
  if (group.createdAt) {
    const t = Date.parse(group.createdAt);
    if (!Number.isNaN(t)) score += Math.min(2, t / 10000000000000);
  }
  return score;
}

export function selectExamples(groups, context, perJudge = 2) {
  const sameArea = groups.filter((group) => (
    group.area === context.area &&
    group.humanJudge &&
    JUDGES.includes(group.humanJudge) &&
    Array.isArray(group.photoPaths) &&
    group.photoPaths.length > 0 &&
    group.id !== context.currentId
  ));

  const result = [];
  for (const judge of JUDGES) {
    const picked = sameArea
      .filter((group) => group.humanJudge === judge)
      .sort((a, b) => scoreGroup(b, context) - scoreGroup(a, context))
      .slice(0, perJudge);
    result.push(...picked);
  }

  return result;
}
