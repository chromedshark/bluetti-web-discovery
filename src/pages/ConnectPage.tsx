import { useState } from "react";
import { useLocation } from "wouter";
import { BluetoothClient } from "../bluetooth/client";
import { DeviceRecognizer } from "../tools/recognizer";
import { useDevice } from "../context/DeviceContext";
import { BrowserWarning } from "../components/BrowserWarning";
import { ErrorDisplay } from "../components/ErrorDisplay";
import { LoadingSpinner } from "../components/LoadingSpinner";

interface ConnectionError {
  message: string;
  details?: string;
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
    let recognizer: DeviceRecognizer | null = null;
    try {
      log.push("Requesting device...");
      const client = await BluetoothClient.request(window.bluettiKeyBundle);

      log.push("Connecting...");
      await client.connect();

      log.push("Recognizing device...");
      recognizer = new DeviceRecognizer(client);
      const { protocolVersion, deviceType } = await recognizer.recognize();

      setDevice({ client, protocolVersion, deviceType });
      navigate("/dashboard");
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        // This is a cancellation, so don't display an error message
      } else {
        if (recognizer) {
          for (const entry of recognizer.log) {
            switch (entry.type) {
              case "started":
                log.push(`Reading ${entry.field}...`);
                break;
              case "success":
                log.push(`Read ${entry.field}: ${entry.value}`);
                break;
              case "error":
                log.push(`Error: ${entry.error.message}`);
                break;
            }
          }
        }
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
