import { useState } from "react";
import { useLocation } from "wouter";
import { BluetoothClient } from "../bluetooth/client";
import { useDevice } from "../context/DeviceContext";
import { BrowserWarning } from "../components/BrowserWarning";
import { ErrorDisplay } from "../components/ErrorDisplay";
import { LoadingSpinner } from "../components/LoadingSpinner";

interface ConnectionError {
  message: string;
  details?: string;
}

function decodeStringField(bytes: Uint8Array): string {
  const lastNonNull = bytes.findLastIndex((byte) => byte !== 0);
  bytes = bytes.subarray(0, lastNonNull + 1);
  return new TextDecoder("utf-8").decode(bytes);
}

function decodeSwapStringField(bytes: Uint8Array): string {
  const registerLength = bytes.length << 1;
  for (let i = 0; i < registerLength; i++) {
    [bytes[2 * i], bytes[2 * i + 1]] = [bytes[2 * i + 1]!, bytes[2 * i]!];
  }
  return decodeStringField(bytes);
}

export function ConnectPage() {
  const { setDevice } = useDevice();
  const [, navigate] = useLocation();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<ConnectionError | null>(null);

  const connect = async () => {
    setConnecting(true);
    setError(null);

    const log: string[] = [];
    try {
      log.push("Requesting device...");
      const client = await BluetoothClient.request(window.bluettiKeyBundle);

      log.push("Connecting...");
      await client.connect();

      // Load protocol version
      log.push("Reading protocol version...");
      const registers = await client.readRegisters(16, 1);
      const protocolVersion = new DataView(registers.buffer).getUint16(0, false);
      log.push(`Protocol version: ${protocolVersion}`);

      // Attempt to load the device type
      let deviceType: string | null = null;
      try {
        await new Promise((r, _) => setTimeout(r, 200));
        const nameStart = protocolVersion < 2000 ? 10 : 110;
        const registers = await client.readRegisters(nameStart, 6);
        deviceType = (protocolVersion < 2000 ? decodeStringField : decodeSwapStringField)(
          registers
        );
        log.push(`Device type: ${deviceType}`);
      } catch (e) {
        log.push(`Failed to read device name: ${e}`);
      }

      setDevice({ client, protocolVersion, deviceType });
      navigate("/dashboard");
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        // This is a cancellation, so don't display an error message
      } else {
        const message = error instanceof Error ? error.message : String(error);
        log.push(`Error: ${message}`);
        setError({ message, details: log.join("\n") });
      }
    }

    setConnecting(false);
  };

  let content: React.ReactNode;
  if (!navigator.bluetooth) {
    content = (
      <>
        <BrowserWarning />
        <button className="connect-button" disabled={true}>
          Connect
        </button>
      </>
    );
  } else if (error) {
    content = (
      <>
        <h2>Connection Failed</h2>
        <ErrorDisplay message={error.message} details={error.details} />
        <button className="connect-button" onClick={connect}>
          Try Again
        </button>
      </>
    );
  } else if (connecting) {
    content = (
      <>
        <h2>Connecting...</h2>
        <LoadingSpinner />
        <p>Please wait while we connect to your device.</p>
      </>
    );
  } else {
    content = (
      <>
        <p>
          Connect to your Bluetti power station to discover which MODBUS registers are readable and
          what data they contain.
        </p>
        <button className="connect-button" onClick={connect}>
          Connect
        </button>
      </>
    );
  }

  return (
    <div className="page connect-page">
      <h1>Bluetti Web Discovery</h1>
      {content}
    </div>
  );
}
