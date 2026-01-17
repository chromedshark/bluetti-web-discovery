interface ErrorDisplayProps {
  message: string;
  details?: string | undefined;
}

export function ErrorDisplay({ message, details }: ErrorDisplayProps) {
  return (
    <div className="error-display">
      <p className="error-message">{message}</p>
      {details && (
        <details>
          <summary>Details</summary>
          <pre className="error-details">{details}</pre>
        </details>
      )}
    </div>
  );
}
