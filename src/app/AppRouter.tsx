import { useEffect } from "react";
import type { UseNebikiAppResult } from "../domain/types";
import { StartScreen } from "../components/screens/StartScreen";
import { AdvanceDiscountScreen } from "../components/screens/AdvanceDiscountScreen";
import { AreaJudgeScreen } from "../components/screens/AreaJudgeScreen";
import { AutoSkipNoticeScreen } from "../components/screens/AutoSkipNoticeScreen";
import { AutoSkipCountScreen } from "../components/screens/AutoSkipCountScreen";
import { RateDisplayScreen } from "../components/screens/RateDisplayScreen";
import { FinalTimeScreen } from "../components/screens/FinalTimeScreen";
import { DoneScreen } from "../components/screens/DoneScreen";
import { Review19Screen } from "../components/screens/Review19Screen";
import { Review19DoneScreen } from "../components/screens/Review19DoneScreen";
import { buildMedianEvaluationDisplay } from "../domain/medianEvaluationPresentation.ts";
import { isSummerModeAvailable } from "../domain/demandCycle.ts";
import { getAreaEvaluationQuickAdjustments } from "../domain/areaEvaluationAdjustment.ts";

type AppRouterProps = {
  app: UseNebikiAppResult;
  testNow?: Date | null;
  onOpenSettings?: () => void;
};

export function AppRouter({ app, testNow, onOpenSettings }: AppRouterProps) {
  const { state, derived, actions } = app;
  const handleReturnHome = () => {
    const ok = window.confirm(
      "トップ画面に戻りますか？\n現在の画面を離れます。必要ならキャンセルしてください。"
    );

    if (!ok) return;

    actions.resetApp();
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [
    state.screen,
    state.currentAreaId,
    state.finalTimeStep,
    derived.weatherConfirmationPending,
  ]);

  switch (state.screen) {
    case "start":
      return (
        <StartScreen
          sessionDraft={state.sessionDraft}
          previousSession={state.session}
          isFixedTimeMode={testNow instanceof Date}
          weatherGuideText={derived.weatherGuideText}
          showAfterRainRecoverySelector={derived.showAfterRainRecoverySelector}
          onChangeSessionDraft={actions.updateSessionDraft}
          weatherConfirmationPending={derived.weatherConfirmationPending}
          weatherCorrectionRequestId={derived.weatherCorrectionRequestId}
          onRequestWeatherConfirmation={actions.requestWeatherConfirmation}
          onEditWeatherInput={actions.editWeatherInput}
          onStart={actions.confirmWeatherInput}
          startButtonLabel={derived.startButtonLabel}
          canStartReview19={derived.canStartReview19Manually && (
            state.sessionDraft.discountTime === "18" ||
            (state.sessionDraft.discountTime === "17" && Boolean(derived.doneNextSessionInfo?.canStart))
          )}
          onStartReview19={actions.startReview19Manually}
          now={testNow ?? undefined}
          onOpenSettings={onOpenSettings}
          demandCycle={derived.demandCycle}
          summerModeAvailable={isSummerModeAvailable(state.sessionDraft.date)}
          canChangeDemandCycle={derived.canChangeDemandCycle}
          demandCycleChangeBlockedReason={derived.demandCycleChangeBlockedReason}
          onChangeDemandCycle={actions.changeDemandCycle}
          globalDiscountAdjustmentPercent={
            derived.globalDiscountAdjustmentPercent
          }
          onChangeGlobalDiscountAdjustment={
            actions.changeGlobalDiscountAdjustment
          }
        />
      );


    case "area_judge":
      if (!derived.currentAreaName) return null;

      return (
        <AreaJudgeScreen
          weekdayText={derived.weekdayText}
          timeText={derived.timeText}
          areaId={state.currentAreaId!}
          areaName={derived.currentAreaName}
          calculatorDraftScope={state.session?.startedAt ?? "current-session"}
          demandCycle={derived.demandCycle}
          basisGuide={derived.basisGuide}
          pendingBanner={derived.pendingBanner}
          timeSwitchNotice={derived.timeSwitchNotice}
          areaCountAssistEnabled={derived.areaCountAssistEnabled}
          areaCountSameItemLimit={derived.areaCountSameItemLimit}
          finalCountMode={state.session?.discountTime === "20"}
          initialAreaCount={state.areaProgressMap[state.currentAreaId!]?.areaCount}
          initialStapleItemCount={state.areaProgressMap[state.currentAreaId!]?.stapleItemCount}
          editableAreaCounts={derived.editableAreaCounts}
          onStartAreaCountCorrection={actions.startAreaCountCorrection}
          getAreaCountRecommendation={actions.getCurrentAreaCountRecommendation}
          onJudge={actions.judgeCurrentArea}
          onSkip={actions.skipCurrentArea}
          onGoBack={actions.goBackOneScreen}
          onReturnHome={handleReturnHome}
          canChooseSkipTarget={derived.canChooseSkipTarget}
          skipTargetOptions={derived.skipTargetOptions}
          onChooseSkipTarget={actions.chooseSkipTargetArea}
        />
      );


    case "auto_skip_notice":
      if (!derived.currentAreaName) return null;

      return (
        <AutoSkipNoticeScreen
          weekdayText={derived.weekdayText}
          timeText={derived.timeText}
          areaName={derived.currentAreaName}
          autoSkipKind={
            state.currentAreaId
              ? state.areaProgressMap[state.currentAreaId]?.autoSkipKind
              : undefined
          }
          discountTime={state.session?.discountTime}
          onRecordCountOnly={actions.startAutoSkippedAreaCountOnly}
          onProcessNormally={actions.processAutoSkippedAreaNormally}
          onSkipWithoutMeasurement={actions.skipAutoSkippedAreaWithoutMeasurement}
          onGoBack={actions.goBackOneScreen}
          onReturnHome={handleReturnHome}
        />
      );

    case "auto_skip_count":
      if (!derived.currentAreaName || !state.currentAreaId) return null;

      return (
        <AutoSkipCountScreen
          key={state.currentAreaId}
          weekdayText={derived.weekdayText}
          timeText={derived.timeText}
          areaName={derived.currentAreaName}
          initialCount={state.areaProgressMap[state.currentAreaId]?.areaCount}
          editableAreaCounts={derived.editableAreaCounts}
          onStartAreaCountCorrection={actions.startAreaCountCorrection}
          onSave={actions.saveAutoSkippedAreaCount}
          onGoBack={actions.goBackOneScreen}
          onReturnHome={handleReturnHome}
        />
      );

    case "rate_display":
      if (!derived.currentAreaName || !state.session) return null;

      return (
        <RateDisplayScreen
          weekdayText={derived.weekdayText}
          timeText={derived.timeText}
          areaName={derived.currentAreaName}
          demandCycle={derived.demandCycle}
          basisGuide={derived.basisGuide}
          pendingBanner={derived.pendingBanner}
          timeSwitchNotice={derived.timeSwitchNotice}
          lateSkipNotice={derived.lateSkipNotice}
          discountTime={state.session.discountTime}
          rateDisplay={derived.rateDisplay}
          rateDisplayBeforeGlobalAdjustment={
            derived.rateDisplayBeforeGlobalAdjustment
          }
          globalDiscountAdjustmentPercent={
            state.session.globalDiscountAdjustmentPercent ?? 0
          }
          medianEvaluationDisplay={buildMedianEvaluationDisplay(
            state.currentAreaId
              ? state.areaProgressMap[state.currentAreaId]
              : undefined,
          )}
          humanEvaluationDetails={
            state.currentAreaId
              ? state.areaProgressMap[state.currentAreaId]?.humanEvaluationDetails
              : undefined
          }
          canOverrideAreaCountEvaluation={Boolean(
            state.currentAreaId &&
            (state.areaProgressMap[state.currentAreaId]?.areaCountEvaluationSource === "history" ||
              buildMedianEvaluationDisplay(state.areaProgressMap[state.currentAreaId])?.status === "ready") &&
            typeof state.areaProgressMap[state.currentAreaId]?.areaCount === "number",
          )}
          onOverrideAreaCountEvaluation={(selection) => {
            if (!state.currentAreaId) return;
            const count = state.areaProgressMap[state.currentAreaId]?.areaCount;
            if (typeof count !== "number") return;
            actions.judgeCurrentArea(
              "normal",
              count,
              undefined,
              undefined,
              selection,
            );
          }}
          areaEvaluationQuickAdjustments={getAreaEvaluationQuickAdjustments({
            screen: state.screen,
            discountTime: state.session.discountTime,
            isTestMode: testNow instanceof Date,
            progress: state.currentAreaId ? state.areaProgressMap[state.currentAreaId] : undefined,
          })}
          onApplyAreaEvaluationAdjustment={actions.applyAreaEvaluationAdjustment}
          showDailyNotice={derived.showDailyNoticeBeforeRate}
          showDayBeforeHolidayNotice={derived.showDayBeforeHolidayNotice}
          showThreeDayHolidayMiddleNotice={derived.showThreeDayHolidayMiddleNotice}
          showHolidayBeforeNormalWeekdayNotice={derived.showHolidayBeforeNormalWeekdayNotice}
          onConfirmDailyNotice={actions.confirmDailyNotice}
          finalGuide={derived.finalGuide ?? undefined}
          onNextArea={actions.goToNextArea}
          onSkip={actions.skipCurrentArea}
          onGoBack={actions.goBackOneScreen}
          onReturnHome={handleReturnHome}
          canChooseSkipTarget={derived.canChooseSkipTarget}
          skipTargetOptions={derived.skipTargetOptions}
          onChooseSkipTarget={actions.chooseSkipTargetArea}
          editableAreaCounts={derived.editableAreaCounts}
          onStartAreaCountCorrection={actions.startAreaCountCorrection}
        />
      );

    case "advance_discount":
      if (!derived.advanceDiscountInstruction || testNow instanceof Date) return null;
      return (
        <AdvanceDiscountScreen
          {...derived.advanceDiscountInstruction}
          onContinue={actions.continueAfterAdvanceDiscount}
        />
      );

    case "final_time":
      if (!derived.finalGuide) return null;

      return (
        <FinalTimeScreen
          weekdayText={derived.weekdayText}
          timeText={derived.timeText}
          timeSwitchNotice={derived.timeSwitchNotice}
          finalGuide={derived.finalGuide}
          finalStep={state.finalTimeStep}
          onAdvance={actions.advanceFinalTimeStep}
          onBack={actions.goBackOneScreen}
          onReturnHome={handleReturnHome}
        />
      );

    case "done":
      return (
        <DoneScreen
          summaryItems={derived.doneSummaryItems}
          onStart1830={
            !(testNow instanceof Date) && state.session?.discountTime === "17" &&
            derived.doneNextSessionInfo?.canStart
              ? () => actions.startNextDoneSession()
              : undefined
          }
          referenceConditionLabel={derived.basisGuide.referenceConditionLabel}
          onGoBack={actions.goBackOneScreen}
          onReturnHome={handleReturnHome}
        />
      );

    case "review19":
      return (
        <Review19Screen
          items={derived.review19Items}
          referenceConditionLabel={derived.review19ReferenceLabel}
          calculatorDraftScope={
            state.review19?.sessionStartedAt ?? state.session?.startedAt ?? "review19-session"
          }
          onCompleteArea={(areaId, count, humanEvaluationSelection) =>
            actions.updateReview19AreaCount(
              areaId,
              count,
              undefined,
              humanEvaluationSelection,
            )
          }
          onSave={actions.saveReview19}
          onGoBack={actions.goBackOneScreen}
          onReturnHome={handleReturnHome}
        />
      );

    case "review19_done":
      return (
        <Review19DoneScreen
          onExportReview19Data={actions.exportCompletedReview19Data}
          onGoBack={actions.goBackOneScreen}
          onReturnHome={handleReturnHome}
        />
      );
  }
}
