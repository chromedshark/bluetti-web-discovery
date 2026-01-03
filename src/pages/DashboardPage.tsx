import type { Dispatch } from "react";
import type { AppAction, DeviceInfo } from "../App";
import { DeviceInfoCard } from "../components/DeviceInfoCard";
import { ActionButtons } from "../components/ActionButtons";

interface DashboardPageProps {
  device: DeviceInfo;
  dispatch: Dispatch<AppAction>;
}

export function DashboardPage({ device, dispatch }: DashboardPageProps) {
  const handleStartDiscovery = () => {
    dispatch({ type: "navigate", to: "discovery" });
  };

  const handleDisconnect = () => {
    dispatch({ type: "disconnect" });
  };

  return (
    <div className="page dashboard-page">
      <h1>Connected</h1>
      <DeviceInfoCard device={device} />
      <ActionButtons onStartDiscovery={handleStartDiscovery} onDisconnect={handleDisconnect} />
    </div>
  );
}
