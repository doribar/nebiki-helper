import { useEffect } from "react";
import type { UseNebikiAppResult } from "../domain/types";
import { StartScreen } from "../components/screens/StartScreen";
import { AreaJudgeScreen } from "../components/screens/AreaJudgeScreen";
import { RateDisplayScreen } from "../components/screens/RateDisplayScreen";
import { FinalTimeScreen } from "../components/screens/FinalTimeScreen";
import { DoneScreen } from "../components/screens/DoneScreen";
import { Review19Screen } from "../components/screens/Review19Screen";
import { Review19DoneScreen } from "../components/screens/Review19DoneScreen";

type AppRouterProps = {
  app: UseNebikiAppResult;
};

export function AppRouter({ app }: AppRouterProps) {
  const { state, derived, actions } = app;

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
          canStartReview19={derived.canStartReview19Manually}
          onStartReview19={actions.startReview19Manually}
        />
      );


    case "review19_weather":
      return (
        <StartScreen
          sessionDraft={state.sessionDraft}
          weatherGuideText={derived.weatherGuideText}
          showAfterRainRecoverySelector={derived.showAfterRainRecoverySelector}
          onChangeSessionDraft={actions.updateSessionDraft}
          onStart={actions.startReview19AfterWeather}
          startButtonLabel="19時売場チェックへ進む"
        />
      );

    case "area_judge":
      if (!derived.currentAreaName) return null;

      return (
        <AreaJudgeScreen
          weekdayText={derived.weekdayText}
          timeText={derived.timeText}
          areaName={derived.currentAreaName}
          showJudgeGuide={derived.showBentoJudgeGuide}
          onJudgeGuideShown={actions.markBentoJudgeGuideShown}
          basisGuide={derived.basisGuide}
          pendingBanner={derived.pendingBanner}
          timeSwitchNotice={derived.timeSwitchNotice}
          onJudge={actions.judgeCurrentArea}
          onSkip={actions.skipCurrentArea}
          onGoBack={actions.goBackOneScreen}
          canChooseSkipTarget={derived.canChooseSkipTarget}
          skipTargetOptions={derived.skipTargetOptions}
          onChooseSkipTarget={actions.chooseSkipTargetArea}
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
          onConfirmDailyNotice={actions.confirmDailyNotice}
          finalGuide={derived.finalGuide ?? undefined}
          onNextArea={actions.goToNextArea}
          onSkip={actions.skipCurrentArea}
          onGoBack={actions.goBackOneScreen}
          canChooseSkipTarget={derived.canChooseSkipTarget}
          skipTargetOptions={derived.skipTargetOptions}
          onChooseSkipTarget={actions.chooseSkipTargetArea}
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
          onBackToTop={actions.resetApp}
        />
      );

    case "review19":
      return (
        <Review19Screen
          items={derived.review19Items}
          referenceLines={derived.review19ReferenceLines}
          onChangeRating={actions.updateReview19Rating}
          onSave={actions.saveReview19}
          onStart19={actions.start19DiscountAfterReview}
        />
      );

    case "review19_done":
      return (
        <Review19DoneScreen
          unexportedCount={derived.review19Export.unexportedCount}
          canExportTen={derived.review19Export.canExportTen}
          onExport={actions.exportReview19Records}
          onStart19={actions.start19DiscountAfterReview}
          onReset={actions.resetApp}
        />
      );

    case "done":
      return (
        <DoneScreen
          summaryItems={derived.doneSummaryItems}
          onReset={actions.resetApp}
          onGoBack={actions.goBackOneScreen}
        />
      );
  }
}
