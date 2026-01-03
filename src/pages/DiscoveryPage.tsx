import type { Dispatch } from "react";
import type { AppAction } from "../App";

interface DiscoveryPageProps {
  dispatch: Dispatch<AppAction>;
}

export function DiscoveryPage({ dispatch }: DiscoveryPageProps) {
  const handleBack = () => {
    dispatch({ type: "navigate", to: "dashboard" });
  };

  return (
    <div className="page discovery-page">
      <h1>Register Discovery</h1>
      <p>Discovery functionality coming soon...</p>
      <button onClick={handleBack} className="secondary-button">
        Back to Dashboard
      </button>
    </div>
  );
}
