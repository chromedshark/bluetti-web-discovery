import type { DeviceInfo } from "../context/DeviceContext";

interface DeviceInfoCardProps {
  device: DeviceInfo;
}

export function DeviceInfoCard({ device }: DeviceInfoCardProps) {
  return (
    <div className="device-info-card">
      <h2>Device Information</h2>
      <dl>
        <dt>Name</dt>
        <dd>{device.client.deviceName}</dd>

        <dt>Device Type</dt>
        <dd>{device.deviceType}</dd>

        <dt>Protocol Version</dt>
        <dd>{device.protocolVersion}</dd>

        <dt>Encrypted</dt>
        <dd>{device.client.isEncrypted ? "Yes" : "No"}</dd>
      </dl>
    </div>
  );
}
