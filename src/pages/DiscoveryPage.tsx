import { useLocation } from "wouter";

export function DiscoveryPage() {
  const [, navigate] = useLocation();

  const handleBack = () => {
    navigate("/dashboard");
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
