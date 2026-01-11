import { useState, useEffect, useRef, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useLocation } from "wouter";
import { useDevice } from "../context/DeviceContext";
import { RegisterScanner, ProgressEvent, type RegisterRange } from "../discovery";

export function DiscoveryPage() {
  const [, navigate] = useLocation();
  const device = useDevice().device!;

  // Set initial range based on device protcol version
  const defaultRange = RegisterScanner.getDefaultRange(device.protocolVersion);
  const [startRegister, setStartRegister] = useState(defaultRange.start);
  const [endRegister, setEndRegister] = useState(defaultRange.end);

  // Scan state
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ scanned: number; total: number } | null>(null);
  const [resumeEnabled, setResumeEnabled] = useState(false);

  // Abort controller for stopping scans
  const abortControllerRef = useRef<AbortController | null>(null);

  // Calculate whether resume is available
  const scannedRegisters = useLiveQuery(
    () => RegisterScanner.getScannedRegisters(device.client),
    [device.client],
    []
  );
  const pendingRanges = useMemo(
    () => RegisterScanner.calculatePendingRanges(startRegister, endRegister, scannedRegisters),
    [startRegister, endRegister, scannedRegisters]
  );
  useEffect(() => {
    const hasPending = pendingRanges.length > 0;
    const hasAnyScanned =
      pendingRanges.length > 1 ||
      (pendingRanges.length === 1 &&
        (pendingRanges[0]!.start !== startRegister || pendingRanges[0]!.end !== endRegister));
    setResumeEnabled(hasAnyScanned && hasPending);
  }, [startRegister, endRegister, pendingRanges]);

  // UI vars
  const isValidRange = startRegister < endRegister;
  const scanDisabled = scanning || !isValidRange;
  const resumeDisabled = scanning || !isValidRange || !resumeEnabled;

  const percentage = progress ? Math.round((progress.scanned / progress.total) * 100) : 0;
  const remaining = progress ? progress.total - progress.scanned : 0;

  const handleBack = () => {
    navigate("/dashboard");
  };

  const runScan = async (ranges: RegisterRange[]) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setScanning(true);

    const scanner = new RegisterScanner(device.client, ranges);

    scanner.addEventListener("progress", (e) => {
      const progressEvent = e as ProgressEvent;
      setProgress({ scanned: progressEvent.scanned, total: progressEvent.total });
    });

    try {
      await scanner.run(controller.signal);
    } finally {
      setScanning(false);
      abortControllerRef.current = null;
    }
  };

  const handleScan = () => {
    runScan([{ start: startRegister, end: endRegister }]);
  };

  const handleResume = async () => {
    runScan(pendingRanges);
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  return (
    <div className="page discovery-page">
      <h1>Register Discovery</h1>

      <div className="scan-config">
        <div className="register-input">
          <label htmlFor="start-register">Starting Register</label>
          <input
            id="start-register"
            type="number"
            value={startRegister}
            onChange={(e) => setStartRegister(parseInt(e.target.value, 10) || 0)}
            disabled={scanning}
            min={0}
            max={65535}
          />
        </div>
        <div className="register-input">
          <label htmlFor="end-register">Ending Register</label>
          <input
            id="end-register"
            type="number"
            value={endRegister}
            onChange={(e) => setEndRegister(parseInt(e.target.value, 10) || 0)}
            disabled={scanning}
            min={0}
            max={65535}
          />
        </div>
      </div>

      {scanning && progress && (
        <div className="scan-progress">
          <progress value={progress.scanned} max={progress.total} aria-label="Scan progress" />
          <span className="progress-text">
            {percentage}% - {remaining} registers remaining
          </span>
        </div>
      )}

      <div className="action-buttons">
        {scanning ? (
          <button onClick={handleStop} className="secondary-button">
            Stop
          </button>
        ) : (
          <>
            <button onClick={handleScan} className="primary-button" disabled={scanDisabled}>
              Scan
            </button>
            <button onClick={handleResume} className="secondary-button" disabled={resumeDisabled}>
              Resume
            </button>
          </>
        )}
      </div>

      {!scanning && (
        <button className="secondary-button" disabled>
          Download Results
        </button>
      )}

      <button onClick={handleBack} className="secondary-button">
        Back to Dashboard
      </button>
    </div>
  );
}
