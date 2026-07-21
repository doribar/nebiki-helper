import assert from 'node:assert/strict';
import {
  AREA_COUNT_DECISION_RULE_VERSION,
  upsertAreaCountRecord,
} from '../src/domain/areaCountHistory.ts';
import type { AreaCountRecord } from '../src/domain/areaCountHistory.ts';
import { LEGACY_AREA_MASTERS, NORMAL_ROUTE } from '../src/domain/area.ts';
import { getNormalTimeRateDisplay } from '../src/domain/discount.ts';
import {
  createDefaultHourlyForecasts,
  resolveWeatherInputForDiscount,
} from '../src/domain/hourlyWeather.ts';
import { getBasisGuideDisplay, getWeekdayBaseInfo } from '../src/domain/weekdayBase.ts';
import {
  STORAGE_KEYS,
  loadPersistedNebikiStateForDate,
  loadReview19SourceState,
  loadRuntimeState,
  saveCurrentSession,
  saveReview19SourceState,
  saveRuntimeState,
} from '../src/domain/storage.ts';
import type {
  AppState,
  AreaId,
  AreaProgress,
  AreaStatus,
  DiscountTime,
  NextSessionSkipRecord,
  SessionData,
  SessionDraft,
} from '../src/domain/types.ts';
import {
  createReview19Snapshot,
  createTimeSwitchPlan,
  getInitialTimeSwitchTarget,
  acknowledgeAutoSkippedProgress,
  normalizeLoadedState,
  processEarlyNextMinus5AreaNormally,
  selectReview19SourceState,
} from '../src/hooks/useNebikiApp.ts';

const TEST_DATE = '2026-07-18';
const TEST_STARTED_AT = '2026-07-18T03:00:00.000Z';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: new MemoryStorage(),
});

function createDraft(discountTime: DiscountTime): SessionDraft {
  return {
    date: TEST_DATE,
    weekday: 6,
    discountTime,
    manualWeekdayOverride: false,
    manualDiscountTimeOverride: false,
    weather: {
      hourlyForecasts: createDefaultHourlyForecasts(),
      afterRainSky: null,
    },
  };
}

function createSession(discountTime: DiscountTime): SessionData {
  return {
    ...createDraft(discountTime),
    startedAt: TEST_STARTED_AT,
  };
}

function createProgressMap(status: AreaStatus = 'completed'): Record<AreaId, AreaProgress> {
  return LEGACY_AREA_MASTERS.reduce((result, area) => {
    result[area.id] = {
      areaId: area.id,
      status,
      areaJudge: status === 'completed' ? 'normal' : null,
    };
    return result;
  }, {} as Record<AreaId, AreaProgress>);
}

function createState(discountTime: DiscountTime, screen: AppState['screen'] = 'done'): AppState {
  return {
    screen,
    session: createSession(discountTime),
    sessionDraft: createDraft(discountTime),
    areaProgressMap: createProgressMap(),
    normalFlowOrder: [...NORMAL_ROUTE],
    currentAreaId: null,
    lastReferenceAreaId: null,
    currentFlow: 'normal',
    pendingDeferredAreaIds: [],
    timeSwitchNotice: null,
    finalTimeStep: 0,
    review19: null,
    review19ExcludedAreaIds: [],
  };
}

function assertCompleteNormalRoute(order: AreaId[]): void {
  assert.equal(order.length, NORMAL_ROUTE.length);
  assert.deepEqual(new Set(order), new Set(NORMAL_ROUTE));
}

function createSkipRecord(params: {
  targetDiscountTime: '18' | '19';
  areaId: AreaId;
  skipKind: NonNullable<NextSessionSkipRecord['skipKind']>;
}): NextSessionSkipRecord {
  return {
    date: TEST_DATE,
    targetDiscountTime: params.targetDiscountTime,
    areaId: params.areaId,
    previousRateText: '30%',
    previousManyRateText: '40%',
    previousNormalRateText: '30%',
    skipKind: params.skipKind,
  };
}

let passCount = 0;

function test(name: string, body: () => void): void {
  localStorage.clear();
  try {
    body();
    passCount += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

test('1. 15時の未完了を先頭にし、その後17時の通常対象をすべて処理する', () => {
  const previousMap = createProgressMap('completed');
  previousMap.tempura = { areaId: 'tempura', status: 'unstarted', areaJudge: null };
  previousMap.hosomaki = {
    areaId: 'hosomaki',
    status: 'skipped_manual',
    areaJudge: null,
    skipReason: 'manual',
  };

  const plan = createTimeSwitchPlan({
    previousMap,
    skippedRecords: [],
    targetDiscountTime: '17',
    completedAt: TEST_STARTED_AT,
  });

  assert.deepEqual(plan.normalFlowOrder.slice(0, 2), ['tempura', 'hosomaki']);
  assert.deepEqual(
    plan.normalFlowOrder.slice(2),
    NORMAL_ROUTE.filter((areaId) => areaId !== 'tempura' && areaId !== 'hosomaki'),
  );
  assertCompleteNormalRoute(plan.normalFlowOrder);
  assert.ok(NORMAL_ROUTE.every((areaId) => plan.areaProgressMap[areaId].status === 'unstarted'));
});

test('2. 17時完了済みエリアも18時30分では未開始の対象へ戻す', () => {
  const previousMap = createProgressMap('completed');
  previousMap.tempura = {
    areaId: 'tempura',
    status: 'postponed_few',
    areaJudge: 'few',
    skipReason: 'few',
  };

  const plan = createTimeSwitchPlan({
    previousMap,
    skippedRecords: [],
    targetDiscountTime: '18',
    completedAt: TEST_STARTED_AT,
  });

  assert.equal(plan.normalFlowOrder[0], 'tempura');
  assert.equal(plan.areaProgressMap.bento_men.status, 'unstarted');
  assert.equal(plan.areaProgressMap.bento_men.completedAt, undefined);
  assertCompleteNormalRoute(plan.normalFlowOrder);
});

test('3. 18時30分完了済みエリアも19時30分では未開始の対象へ戻す', () => {
  const previousMap = createProgressMap('completed');
  previousMap.sushi = { areaId: 'sushi', status: 'unstarted', areaJudge: null };

  const plan = createTimeSwitchPlan({
    previousMap,
    skippedRecords: [],
    targetDiscountTime: '19',
    completedAt: TEST_STARTED_AT,
  });

  assert.equal(plan.normalFlowOrder[0], 'sushi');
  assert.equal(plan.areaProgressMap.bento_men.status, 'unstarted');
  assert.equal(plan.areaProgressMap.sushi.status, 'unstarted');
  assertCompleteNormalRoute(plan.normalFlowOrder);
});

test('4. 早め次時刻-5%だけを自動スキップし、通常の+5%記録は新時刻の対象にする', () => {
  const plan = createTimeSwitchPlan({
    previousMap: createProgressMap('completed'),
    skippedRecords: [
      createSkipRecord({
        targetDiscountTime: '18',
        areaId: 'inari',
        skipKind: 'early_next_minus5',
      }),
      createSkipRecord({
        targetDiscountTime: '18',
        areaId: 'tempura',
        skipKind: 'late_plus5',
      }),
    ],
    targetDiscountTime: '18',
    completedAt: TEST_STARTED_AT,
  });

  assert.equal(plan.areaProgressMap.inari.status, 'auto_skipped_late_time');
  assert.equal(plan.areaProgressMap.inari.autoSkipKind, 'early_next_minus5');
  assert.equal(plan.areaProgressMap.inari.skipReason, 'late_time');
  assert.equal(plan.areaProgressMap.tempura.status, 'unstarted');
  assert.equal(plan.areaProgressMap.tempura.autoSkipKind, undefined);
});

test('5. 自動切替後の開始画面を再読み込みしてもtimeSwitchTargetを復元する', () => {
  const previousState = createState('15', 'start');
  previousState.areaProgressMap.tempura = {
    areaId: 'tempura',
    status: 'skipped_manual',
    areaJudge: null,
    skipReason: 'manual',
  };
  saveCurrentSession(previousState);
  saveRuntimeState({
    areaJudgeSelection: null,
    resumeTargetScreen: null,
    timeSwitchTarget: '17',
    undoSnapshot: null,
    screenHistory: [],
  });

  const restored = loadPersistedNebikiStateForDate(TEST_DATE);
  assert.equal(restored.runtimeState?.timeSwitchTarget, '17');
  assert.equal(
    getInitialTimeSwitchTarget(restored.runtimeState?.timeSwitchTarget, false),
    '17',
  );
  assert.equal(getInitialTimeSwitchTarget('18:30', false), null);
  assert.equal(getInitialTimeSwitchTarget('17', true), null);
  const restoredState = normalizeLoadedState(restored.currentSession, createDraft('17'));
  const plan = createTimeSwitchPlan({
    previousMap: restoredState.areaProgressMap,
    skippedRecords: restored.nextSessionSkipRecords,
    targetDiscountTime: restored.runtimeState!.timeSwitchTarget!,
    completedAt: TEST_STARTED_AT,
  });
  assert.equal(plan.normalFlowOrder[0], 'tempura');

  localStorage.setItem(
    STORAGE_KEYS.runtimeState,
    JSON.stringify({
      areaJudgeSelection: null,
      resumeTargetScreen: null,
      timeSwitchTarget: '18:30',
      undoSnapshot: null,
      screenHistory: [],
    }),
  );
  assert.equal(loadRuntimeState()?.timeSwitchTarget, null);
});

test('6. 再読み込みで早め次時刻と自動スキップ種別を保持し、不正値は破棄する', () => {
  const persistedState = createState('17', 'rate_display');
  persistedState.currentAreaId = 'inari';
  persistedState.areaProgressMap.inari = {
    areaId: 'inari',
    status: 'auto_skipped_late_time',
    areaJudge: 'normal',
    autoSkipKind: 'early_next_minus5',
    earlyNextMinus5TargetDiscountTime: '18',
  };
  persistedState.areaProgressMap.sushi = {
    areaId: 'sushi',
    status: 'auto_skipped_late_time',
    areaJudge: 'normal',
    autoSkipKind: 'late_plus5',
    earlyNextMinus5TargetDiscountTime: '19',
  };
  const invalidProgress = persistedState.areaProgressMap.tempura as AreaProgress & {
    autoSkipKind: string;
    earlyNextMinus5TargetDiscountTime: string;
  };
  invalidProgress.autoSkipKind = 'unknown';
  invalidProgress.earlyNextMinus5TargetDiscountTime = '20';
  saveCurrentSession(persistedState);

  const restored = loadPersistedNebikiStateForDate(TEST_DATE);
  const normalized = normalizeLoadedState(restored.currentSession, createDraft('17'));
  assert.equal(normalized.areaProgressMap.inari.earlyNextMinus5TargetDiscountTime, '18');
  assert.equal(normalized.areaProgressMap.inari.autoSkipKind, 'early_next_minus5');
  assert.equal(normalized.areaProgressMap.sushi.earlyNextMinus5TargetDiscountTime, '19');
  assert.equal(normalized.areaProgressMap.sushi.autoSkipKind, 'late_plus5');
  assert.equal(normalized.areaProgressMap.tempura.earlyNextMinus5TargetDiscountTime, undefined);
  assert.equal(normalized.areaProgressMap.tempura.autoSkipKind, undefined);
});

test('7. 18時30分完了後の19時チェックは保存済みの同日17時セッションを参照する', () => {
  const source17 = createState('17', 'done');
  source17.session!.weather.hourlyForecasts['18'] = {
    weather: 'rain',
    tempC: 17,
    windMs: 5,
  };
  source17.areaProgressMap.bento_men = {
    areaId: 'bento_men',
    status: 'completed',
    areaJudge: 'many',
    areaCount: 17,
    areaCountEvaluation: 'many',
    areaCountEvaluationSource: 'history',
    areaRateAdjustment: 5,
    areaCountDecisionBasis: {
      ruleVersion: AREA_COUNT_DECISION_RULE_VERSION,
      evaluationSource: 'history',
      recommendationStatus: 'ready',
      sampleSize: 16,
      requiredSampleSize: 16,
      medianCount: 12,
      finalEvaluation: 'many',
      areaRateAdjustment: 5,
    },
    completedRateText: '30%',
    completedNormalRateText: '30%',
    completedManyRateText: '40%',
  };
  source17.review19ExcludedAreaIds = ['tempura'];
  saveReview19SourceState(source17);

  const current18 = createState('18', 'done');
  current18.session!.weather.hourlyForecasts['18'] = {
    weather: 'sunny',
    tempC: 30,
    windMs: 1,
  };
  current18.areaProgressMap.bento_men.areaCount = 99;

  const selected = selectReview19SourceState({
    currentState: current18,
    savedSourceState: loadReview19SourceState(),
    currentDate: TEST_DATE,
  });

  assert.ok(selected?.session);
  assert.equal(selected.session.discountTime, '17');
  assert.deepEqual(selected.session.weather.hourlyForecasts['18'], {
    weather: 'rain',
    tempC: 17,
    windMs: 5,
  });
  assert.equal(selected.areaProgressMap.bento_men.areaJudge, 'many');
  assert.equal(selected.areaProgressMap.bento_men.areaCount, 17);
  assert.equal(selected.areaProgressMap.bento_men.completedRateText, '30%');
  assert.equal(selected.areaProgressMap.bento_men.areaRateAdjustment, 5);
  assert.equal(
    selected.areaProgressMap.bento_men.areaCountDecisionBasis?.ruleVersion,
    AREA_COUNT_DECISION_RULE_VERSION,
  );
  assert.deepEqual(selected.review19ExcludedAreaIds, ['tempura']);

  const resolvedWeather = resolveWeatherInputForDiscount(
    selected.session.weather,
    selected.session.discountTime,
  );
  const weekdayBaseInfo = getWeekdayBaseInfo(
    selected.session.weekday,
    selected.session.discountTime,
    resolvedWeather,
    selected.session.date,
  );
  const basisGuide = getBasisGuideDisplay({
    date: selected.session.date,
    weekday: selected.session.weekday,
    discountTime: selected.session.discountTime,
    weather: resolvedWeather,
  });
  const snapshot = createReview19Snapshot({
    capturedAt: TEST_STARTED_AT,
    session: selected.session,
    resolvedWeather,
    weekdayBaseInfo,
    basisGuide,
    lateTimeBonus: 0,
    excludedAreaIds: selected.review19ExcludedAreaIds,
    areaProgressMap: selected.areaProgressMap,
    doneSummaryItems: [
      {
        areaId: 'bento_men',
        areaName: '弁当・麺類',
        judgeText: '多い',
        rateText: '30%',
        manyRateText: '40%',
        normalRateText: '30%',
      },
    ],
  });
  assert.equal(snapshot.session.discountTime, '17');
  assert.deepEqual(snapshot.session.weather, selected.session.weather);
  assert.equal(snapshot.areas.bento_men.areaJudge, 'many');
  assert.equal(snapshot.areas.bento_men.areaCount, 17);
  assert.equal(snapshot.areas.bento_men.rateText, '30%');
  assert.equal(
    snapshot.areas.bento_men.areaCountDecisionBasis?.ruleVersion,
    AREA_COUNT_DECISION_RULE_VERSION,
  );
});

test('8. 19時30分から20時30分は通常順・全エリア初期化を維持する', () => {
  const previousMap = createProgressMap('completed');
  previousMap.hosomaki = {
    areaId: 'hosomaki',
    status: 'skipped_manual',
    areaJudge: null,
    skipReason: 'manual',
  };

  const plan = createTimeSwitchPlan({
    previousMap,
    skippedRecords: [],
    targetDiscountTime: '20',
    completedAt: TEST_STARTED_AT,
  });

  assert.deepEqual(plan.normalFlowOrder, NORMAL_ROUTE);
  assert.equal(plan.normalFlowOrder[0], 'bento_men');
  assert.ok(NORMAL_ROUTE.every((areaId) => plan.areaProgressMap[areaId].status === 'unstarted'));
});

function createEarlyChoiceState(): AppState {
  const state = createState('19', 'auto_skip_notice');
  state.currentAreaId = 'inari';
  state.areaProgressMap.inari = {
    areaId: 'inari',
    status: 'auto_skipped_late_time',
    areaJudge: 'many',
    areaCount: 18,
    areaCountEvaluation: 'many',
    areaCountEvaluationSource: 'history',
    areaRateAdjustment: 5,
    completedRateText: '40%',
    completedManyRateText: '45%',
    previousRateText: '35%',
    previousManyRateText: '40%',
    skipReason: 'late_time',
    autoSkipKind: 'early_next_minus5',
    earlyNextMinus5TargetDiscountTime: '19',
  };
  return state;
}

test('9. 選択前の再読み込みは同じ先取り値引済み選択画面へ戻る', () => {
  saveCurrentSession(createEarlyChoiceState());
  const restored = normalizeLoadedState(loadPersistedNebikiStateForDate(TEST_DATE).currentSession, createDraft('19'));
  assert.equal(restored.screen, 'auto_skip_notice');
  assert.equal(restored.currentAreaId, 'inari');
  assert.equal(restored.areaProgressMap.inari.autoSkipKind, 'early_next_minus5');
  assert.equal(restored.areaProgressMap.inari.visitedAt, undefined);
});

test('10. 今回は値引するを選ぶと同じエリアの新しい残数入力状態へ進む', () => {
  const processed = processEarlyNextMinus5AreaNormally(createEarlyChoiceState());
  const progress = processed.areaProgressMap.inari;
  assert.equal(processed.screen, 'area_judge');
  assert.equal(processed.currentAreaId, 'inari');
  assert.deepEqual(progress, { areaId: 'inari', status: 'unstarted', areaJudge: null });
  assert.equal(progress.areaCount, undefined);
  assert.equal(progress.completedRateText, undefined);
  assert.equal(progress.autoSkipKind, undefined);
});

test('11. 通常処理への移行は現在の正式時刻・天候・通常ルートを維持する', () => {
  const choice = createEarlyChoiceState();
  choice.session!.weather.hourlyForecasts['19'] = { weather: 'rain', tempC: 21, windMs: 4 };
  const processed = processEarlyNextMinus5AreaNormally(choice);
  assert.equal(processed.session?.discountTime, '19');
  assert.deepEqual(processed.session?.weather.hourlyForecasts['19'], { weather: 'rain', tempC: 21, windMs: 4 });
  assert.deepEqual(processed.normalFlowOrder, choice.normalFlowOrder);
});

test('12. 今回は値引する選択後の再読み込みで再びスキップ扱いへ戻らない', () => {
  const processed = processEarlyNextMinus5AreaNormally(createEarlyChoiceState());
  saveCurrentSession(processed);
  const restored = normalizeLoadedState(loadPersistedNebikiStateForDate(TEST_DATE).currentSession, createDraft('19'));
  assert.equal(restored.screen, 'area_judge');
  assert.equal(restored.areaProgressMap.inari.status, 'unstarted');
  assert.equal(restored.areaProgressMap.inari.autoSkipKind, undefined);
});

test('13. スキップする選択は従来のauto_skipped_late_time完了状態を維持する', () => {
  const choice = createEarlyChoiceState();
  const skippedProgress = acknowledgeAutoSkippedProgress(choice.areaProgressMap.inari, TEST_STARTED_AT);
  assert.equal(skippedProgress.status, 'auto_skipped_late_time');
  assert.equal(skippedProgress.autoSkipKind, 'early_next_minus5');
  assert.equal(skippedProgress.visitedAt, TEST_STARTED_AT);
  assert.equal(skippedProgress.completedAt, TEST_STARTED_AT);
});

test('14. スキップ選択後の保存復元はスキップ済み状態を保持する', () => {
  const choice = createEarlyChoiceState();
  choice.areaProgressMap.inari = acknowledgeAutoSkippedProgress(choice.areaProgressMap.inari, TEST_STARTED_AT);
  choice.screen = 'done';
  choice.currentAreaId = null;
  saveCurrentSession(choice);
  const restored = normalizeLoadedState(loadPersistedNebikiStateForDate(TEST_DATE).currentSession, createDraft('19'));
  assert.equal(restored.areaProgressMap.inari.status, 'auto_skipped_late_time');
  assert.equal(restored.areaProgressMap.inari.visitedAt, TEST_STARTED_AT);
});

test('15. 通常処理への移行は他のエリア進捗へ影響しない', () => {
  const choice = createEarlyChoiceState();
  const beforeTempura = { ...choice.areaProgressMap.tempura };
  const processed = processEarlyNextMinus5AreaNormally(choice);
  assert.deepEqual(processed.areaProgressMap.tempura, beforeTempura);
});

function createAreaRecord(params: {
  discountTime: '17' | '19';
  sessionStartedAt: string;
  recordedAt: string;
  count: number;
}): AreaCountRecord {
  return {
    date: TEST_DATE,
    sessionStartedAt: params.sessionStartedAt,
    recordedAt: params.recordedAt,
    areaId: 'inari',
    discountTime: params.discountTime,
    actualWeekdayGroup: '金土',
    count: params.count,
  };
}

test('16. 先取り記録を残して正式時刻の通常記録を追加できる', () => {
  const earlyRecord = createAreaRecord({ discountTime: '17', sessionStartedAt: '2026-07-18T08:00:00.000Z', recordedAt: '2026-07-18T09:25:00.000Z', count: 18 });
  const formalRecord = createAreaRecord({ discountTime: '19', sessionStartedAt: TEST_STARTED_AT, recordedAt: '2026-07-18T10:31:00.000Z', count: 12 });
  const records = upsertAreaCountRecord(upsertAreaCountRecord([], earlyRecord), formalRecord);
  assert.equal(records.length, 2);
  assert.ok(records.some((record) => record.discountTime === '17' && record.count === 18));
  assert.ok(records.some((record) => record.discountTime === '19' && record.count === 12));
});

test('17. 同じ正式時刻・セッション・エリアの通常記録は重複しない', () => {
  const first = createAreaRecord({ discountTime: '19', sessionStartedAt: TEST_STARTED_AT, recordedAt: '2026-07-18T10:31:00.000Z', count: 12 });
  const updated = createAreaRecord({ discountTime: '19', sessionStartedAt: TEST_STARTED_AT, recordedAt: '2026-07-18T10:32:00.000Z', count: 10 });
  const records = upsertAreaCountRecord(upsertAreaCountRecord([], first), updated);
  assert.equal(records.length, 1);
  assert.equal(records[0].count, 10);
  assert.equal(records[0].recordedAt, updated.recordedAt);
});

test('18. 現在の正式時刻の通常計算を使い、先取り時の表示率を再利用しない', () => {
  const currentRate = getNormalTimeRateDisplay({
    discountTime: '19',
    weatherBonus: 5,
    areaJudge: 'many',
    areaRateAdjustment: 5,
    weekdayBase: '金土',
  });
  assert.notEqual(currentRate.many.main, createEarlyChoiceState().areaProgressMap.inari.previousRateText);
  assert.match(currentRate.many.main, /%/);
});

test('19. 先取り対象外エリアと別種の自動スキップは通常処理へ開き直さない', () => {
  const state = createEarlyChoiceState();
  state.areaProgressMap.inari.autoSkipKind = 'late_plus5';
  assert.equal(processEarlyNextMinus5AreaNormally(state), state);
  state.screen = 'area_judge';
  state.areaProgressMap.inari.autoSkipKind = 'early_next_minus5';
  assert.equal(processEarlyNextMinus5AreaNormally(state), state);
});

console.log(`PASS: integration ${passCount}/19`);
