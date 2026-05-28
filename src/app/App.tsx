import { AppRouter } from "./AppRouter";
import { useNebikiApp } from "../hooks/useNebikiApp";

export default function App() {
  const app = useNebikiApp();

  return <AppRouter app={app} />;
}
