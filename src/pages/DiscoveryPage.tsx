import { useState, useEffect, useRef, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useLocation } from "wouter";
import { useDevice } from "../context/DeviceContext";
import {
  RegisterScanner,
  ProgressEvent,
  type RegisterRange,
  hasScanResults,
  buildExportBlob,
} from "../discovery";

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

  // Dialog ref for export options
  const dialogRef = useRef<HTMLDialogElement>(null);

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

  // Check if download is available (any scan results exist for this device)
  const hasResults = useLiveQuery(
    () => hasScanResults(device.client.id),
    [device.client.id],
    false
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

  const handleDownloadClick = () => {
    dialogRef.current?.showModal();
  };

  const handleDownload = async (includeData: boolean) => {
    dialogRef.current?.close();

    const blob = await buildExportBlob(device.client.id, device.deviceType || "Unknown", {
      includeData,
    });

    // Generate filename: bluetti-{deviceName}-scan-{YYYY-MM-DD}.json
    const date = new Date().toISOString().split("T")[0];
    const name = device.client.deviceName || "unknown";
    const filename = `bluetti-${name}-scan-${date}.json`;

    // Trigger browser download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
        <button className="secondary-button" disabled={!hasResults} onClick={handleDownloadClick}>
          Download Results
        </button>
      )}

      <button onClick={handleBack} className="secondary-button">
        Back to Dashboard
      </button>

      <dialog ref={dialogRef} className="export-dialog">
        <h2>Export Options</h2>
        <p>
          Include raw register data? This may contain private information like your wifi connection
          password and device serial numbers.
        </p>
        <div className="dialog-buttons">
          <button onClick={() => handleDownload(true)} className="primary-button">
            Include Data
          </button>
          <button onClick={() => handleDownload(false)} className="secondary-button">
            Exclude Data
          </button>
          <button onClick={() => dialogRef.current?.close()} className="secondary-button">
            Cancel
          </button>
        </div>
      </dialog>
    </div>
  );
}
