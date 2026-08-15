import { AudienceApp } from "./AudienceApp";
import { PresenterApp } from "./PresenterApp";

export default function App() {
  const mode = new URLSearchParams(window.location.search).get("mode");
  return mode === "audience" ? <AudienceApp /> : <PresenterApp />;
}
