import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { BluetoothClient } from "../bluetooth/client";

export interface DeviceInfo {
  client: BluetoothClient;
  protocolVersion: number;
  deviceType: string | null;
}

interface DeviceContextValue {
  device: DeviceInfo | null;
  setDevice: (device: DeviceInfo | null) => void;
  disconnect: () => void;
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

interface DeviceProviderProps {
  children: ReactNode;
}

export function DeviceProvider({ children }: DeviceProviderProps) {
  const [device, setDeviceState] = useState<DeviceInfo | null>(null);

  const setDevice = useCallback((newDevice: DeviceInfo | null) => {
    setDeviceState(newDevice);
  }, []);

  const disconnect = useCallback(() => {
    if (device) {
      device.client.disconnect();
      setDeviceState(null);
    }
  }, [device]);

  return (
    <DeviceContext.Provider value={{ device, setDevice, disconnect }}>
      {children}
    </DeviceContext.Provider>
  );
}

export function useDevice(): DeviceContextValue {
  const context = useContext(DeviceContext);
  if (!context) {
    throw new Error("useDevice must be used within a DeviceProvider");
  }
  return context;
}
