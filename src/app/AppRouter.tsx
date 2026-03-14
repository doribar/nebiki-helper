import type { UseNebikiAppResult } from "../domain/types";
import { StartScreen } from "../components/screens/StartScreen";
import { AreaJudgeScreen } from "../components/screens/AreaJudgeScreen";
import { RateDisplayScreen } from "../components/screens/RateDisplayScreen";
import { ManyProductInputScreen } from "../components/screens/ManyProductInputScreen";
import { PendingGuideScreen } from "../components/screens/PendingGuideScreen";
import { DoneScreen } from "../components/screens/DoneScreen";
import { FinalTimeScreen } from "../components/screens/FinalTimeScreen";

type AppRouterProps = {
  app: UseNebikiAppResult;
};

export function AppRouter({ app }: AppRouterProps) {
  const { state, derived, actions } = app;

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
          discountTime={state.session.discountTime}
          rateDisplay={derived.rateDisplay}
          finalGuide={derived.finalGuide ?? undefined}
          previousManyProducts={derived.previousManyProducts}
          consecutiveManyRate={derived.consecutiveManyRate}
          onOpenManyInput={actions.openManyInput}
          onNextArea={actions.goToNextArea}
          onSkip={actions.skipCurrentArea}
        />
      );

    case "many_input":
      if (!derived.currentAreaName) return null;

      return (
        <ManyProductInputScreen
          weekdayText={derived.weekdayText}
          timeText={derived.timeText}
          areaName={derived.currentAreaName}
          draftValues={state.manyInputDraft}
          onChangeDraftValues={actions.changeManyDraftValues}
          onAddRow={actions.addManyDraftRow}
          onRemoveRow={actions.removeManyDraftRow}
          onSave={actions.saveManyDraft}
          onCancel={actions.cancelManyDraft}
        />
      );

    case "pending_guide":
      if (!derived.pendingCandidate || !derived.pendingReasonText) {
        return <DoneScreen onReset={actions.resetApp} />;
      }

      return (
        <PendingGuideScreen
          weekdayText={derived.weekdayText}
          timeText={derived.timeText}
          areaName={derived.pendingCandidate.areaName}
          reasonText={derived.pendingReasonText}
          onOpen={actions.openPendingArea}
          onPostponeAgain={actions.postponePendingAgain}
          onMarkCompleted={actions.markPendingCompleted}
        />
      );

    case "done":
      return <DoneScreen onReset={actions.resetApp} />;

    case "final_time":
  return (
    <FinalTimeScreen
      weekdayText={derived.weekdayText}
      timeText={derived.timeText}
      onBackToTop={actions.resetApp}
    />
  );

    default:
      return null;
  }
}