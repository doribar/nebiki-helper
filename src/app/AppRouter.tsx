import { useEffect } from "react";
import type { UseNebikiAppResult } from "../domain/types";
import { StartScreen } from "../components/screens/StartScreen";
import { AreaJudgeScreen } from "../components/screens/AreaJudgeScreen";
import { RateDisplayScreen } from "../components/screens/RateDisplayScreen";
import { FinalTimeScreen } from "../components/screens/FinalTimeScreen";
import { DoneScreen } from "../components/screens/DoneScreen";

type AppRouterProps = {
  app: UseNebikiAppResult;
};

export function AppRouter({ app }: AppRouterProps) {
  const { state, derived, actions } = app;

  useEffect(() => {
  window.scrollTo({ top: 0, behavior: "auto" });
}, [state.screen, state.currentAreaId]);

  switch (state.screen) {
    case "start":
            return (
        <StartScreen
          sessionDraft={state.sessionDraft}
          weatherGuideText={derived.weatherGuideText}
          onChangeSessionDraft={actions.updateSessionDraft}
          onStart={actions.startSession}
        />
      );

    case "area_judge":
      if (!derived.currentAreaName) return null;

      return (
        <AreaJudgeScreen
          weekdayText={derived.weekdayText}
          timeText={derived.timeText}
          areaName={derived.currentAreaName}
          basisGuide={derived.basisGuide}
          pendingBanner={derived.pendingBanner}
          timeSwitchNotice={derived.timeSwitchNotice}
          onSelectMany={actions.selectAreaMany}
          onSelectNormal={actions.selectAreaNormal}
          onSelectFew={actions.selectAreaFew}
          onSkip={actions.skipCurrentArea}
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
          discountTime={state.session.discountTime}
          rateDisplay={derived.rateDisplay}
          finalGuide={derived.finalGuide ?? undefined}
          onNextArea={actions.goToNextArea}
          onSkip={actions.skipCurrentArea}
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
      onBackToTop={actions.resetApp}
    />
  );

    case "done":
      return <DoneScreen onReset={actions.resetApp} />;

    default:
      return null;
  }
}