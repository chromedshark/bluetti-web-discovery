import { useLocation } from "wouter";
import { useDevice } from "../context/DeviceContext";
import { DeviceInfoCard } from "../components/DeviceInfoCard";
import { ActionButtons } from "../components/ActionButtons";

export function DashboardPage() {
  const { device, disconnect } = useDevice();
  const [, navigate] = useLocation();

  // Device is guaranteed non-null by RequireDevice guard in App.tsx
  if (!device) return null;

  const handleStartDiscovery = () => {
    navigate("/discovery");
  };

  const handleDisconnect = () => {
    disconnect();
    navigate("/");
  };

  return (
    <div className="page dashboard-page">
      <h1>Connected</h1>
      <DeviceInfoCard device={device} />
      <ActionButtons onStartDiscovery={handleStartDiscovery} onDisconnect={handleDisconnect} />
    </div>
  );
}
