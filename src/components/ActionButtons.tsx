interface ActionButtonsProps {
  onStartDiscovery: () => void;
  onDisconnect: () => void;
}

export function ActionButtons({ onStartDiscovery, onDisconnect }: ActionButtonsProps) {
  return (
    <div className="action-buttons">
      <button onClick={onStartDiscovery} className="primary-button">
        Start Discovery
      </button>
      <button onClick={onDisconnect} className="secondary-button">
        Disconnect
      </button>
    </div>
  );
}
