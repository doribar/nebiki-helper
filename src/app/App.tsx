import { useEffect, useState } from "react";
import { AppRouter } from "./AppRouter";
import { useNebikiApp } from "../hooks/useNebikiApp";
import { parseTrainingStepFromHash } from "../domain/trainingMode";

function getCurrentTrainingStep() {
  if (typeof window === "undefined") return parseTrainingStepFromHash("");
  return parseTrainingStepFromHash(window.location.hash);
}

export default function App() {
  const [trainingStep, setTrainingStep] = useState(getCurrentTrainingStep);
  const app = useNebikiApp({ trainingStep });

  useEffect(() => {
    const handleHashChange = () => {
      setTrainingStep(getCurrentTrainingStep());
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return <AppRouter app={app} />;
}
