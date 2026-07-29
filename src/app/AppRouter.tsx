import { useEffect } from "react";
import type { UseNebikiAppResult } from "../domain/types";
import { StartScreen } from "../components/screens/StartScreen";
import { AreaJudgeScreen } from "../components/screens/AreaJudgeScreen";
import { AutoSkipNoticeScreen } from "../components/screens/AutoSkipNoticeScreen";
import { AutoSkipCountScreen } from "../components/screens/AutoSkipCountScreen";
import { RateDisplayScreen } from "../components/screens/RateDisplayScreen";
import { FinalTimeScreen } from "../components/screens/FinalTimeScreen";
import { DoneScreen } from "../components/screens/DoneScreen";
import { Review19Screen } from "../components/screens/Review19Screen";
import { Review19DoneScreen } from "../components/screens/Review19DoneScreen";

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
  }, [state.screen, state.currentAreaId, state.finalTimeStep]);

  switch (state.screen) {
    case "start":
      return (
        <StartScreen
          sessionDraft={state.sessionDraft}
          weatherGuideText={derived.weatherGuideText}
          showAfterRainRecoverySelector={derived.showAfterRainRecoverySelector}
          onChangeSessionDraft={actions.updateSessionDraft}
          onStart={actions.startSession}
          startButtonLabel={derived.startButtonLabel}
          canStartReview19={derived.canStartReview19Manually && state.sessionDraft.discountTime === "18"}
          onStartReview19={actions.startReview19Manually}
          now={testNow ?? undefined}
          onOpenSettings={onOpenSettings}
          previousDayDiscardTarget={derived.previousDayDiscardTarget}
          onSavePreviousDayDiscardCount={actions.savePreviousDayDiscardCount}
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
          showJudgeGuide={derived.showBentoJudgeGuide}
          onJudgeGuideShown={actions.markBentoJudgeGuideShown}
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
          basisGuide={derived.basisGuide}
          pendingBanner={derived.pendingBanner}
          timeSwitchNotice={derived.timeSwitchNotice}
          lateSkipNotice={derived.lateSkipNotice}
          discountTime={state.session.discountTime}
          rateDisplay={derived.rateDisplay}
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
          referenceText={derived.basisGuide.referenceText}
          timeText={derived.timeText}
          showDailyDataActions={
            state.session?.discountTime === "20" &&
            Boolean(state.finalizedDayRecordId)
          }
          memo={derived.finalizedDayMemo}
          onSaveMemo={actions.saveFinalizedDayMemo}
          onExportDailyData={
            state.finalizedDayRecordId
              ? (memo) => {
                  return actions.exportCompletedDailyData(memo);
                }
              : undefined
          }
          onGoBack={actions.goBackOneScreen}
          onReturnHome={handleReturnHome}
        />
      );

    case "review19":
      return (
        <Review19Screen
          items={derived.review19Items}
          calculatorDraftScope={
            state.review19?.sessionStartedAt ?? state.session?.startedAt ?? "review19-session"
          }
          onChangeAreaCount={actions.updateReview19AreaCount}
          onSave={actions.saveReview19}
          onGoBack={actions.goBackOneScreen}
          onReturnHome={handleReturnHome}
        />
      );

    case "review19_done":
      return (
        <Review19DoneScreen
          onExportReview19Data={() => {
            actions.exportCompletedReview19Data();
          }}
          onGoBack={actions.goBackOneScreen}
          onReturnHome={handleReturnHome}
        />
      );
  }
}
