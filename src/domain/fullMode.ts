export type FullModeNoticeSegment = {
  text: string;
  emphasis?: boolean;
};

export const FULL_MODE_NOTICE_ITEMS: readonly (readonly FullModeNoticeSegment[])[] = [
  [
    { text: "残り2個", emphasis: true },
    { text: "の商品は" },
    { text: "「多い」にしない", emphasis: true },
  ],
  [
    { text: "残り1個", emphasis: true },
    { text: "の商品は" },
    { text: "「少ない」にする", emphasis: true },
  ],
  [
    { text: "定番商品", emphasis: true },
    { text: "は、表示値引率から" },
    { text: "-10%", emphasis: true },
  ],
  [
    { text: "夜によく売れる商品", emphasis: true },
    { text: "は、表示値引率から" },
    { text: "-10%", emphasis: true },
  ],
  [
    { text: "見た目が悪い個別商品", emphasis: true },
    { text: "は、表示値引率に" },
    { text: "+10%", emphasis: true },
  ],
  [
    { text: "不人気な商品", emphasis: true },
    { text: "は、表示値引率に" },
    { text: "+10%", emphasis: true },
  ],
  [
    { text: "多い・少ないの判断", emphasis: true },
    { text: "は、残り数だけでなく" },
    { text: "商品の減り方", emphasis: true },
    { text: "も含める" },
  ],
  [
    { text: "広告商品", emphasis: true },
    { text: "は、表示値引率から" },
    { text: "-10%", emphasis: true },
  ],
] as const;

export const FULL_MODE_NOTICE_TEXTS = FULL_MODE_NOTICE_ITEMS.map((segments) =>
  segments.map((segment) => segment.text).join(""),
);

const LEGACY_TRAINING_URL_HASH = /^#\/step[1-8]\/?$/i;

/** 旧習熟URLだけを正規URLへ移し、機能の切替には使用しない。 */
export function getCanonicalUrlForLegacyHash(params: {
  pathname: string;
  search: string;
  hash: string;
}): string | null {
  return LEGACY_TRAINING_URL_HASH.test(params.hash)
    ? `${params.pathname}${params.search}`
    : null;
}
