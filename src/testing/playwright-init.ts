import { MockBluetoothDevice } from "./mock-bluetooth-device";
import { db } from "../database";
import type { MockBluetoothDeviceConfig } from "./mock-bluetooth-device";

export class BluetoothMock {
  private _resolveRequest: ((arg: MockBluetoothDevice) => void) | null = null;
  private _rejectRequest: ((arg: Error) => void) | null = null;
  private _currentDevice: MockBluetoothDevice | null = null;

  get currentDevice(): MockBluetoothDevice | null {
    return this._currentDevice;
  }

  async requestDevice(): Promise<MockBluetoothDevice> {
    return new Promise<MockBluetoothDevice>((resolve, reject) => {
      this._resolveRequest = resolve;
      this._rejectRequest = reject;
    });
  }

  buildDevice(config: MockBluetoothDeviceConfig): MockBluetoothDevice {
    return new MockBluetoothDevice(config);
  }

  resolveDevice(device: MockBluetoothDevice | null): void {
    if (!this._resolveRequest || !this._rejectRequest) throw new Error("No pending device request");

    if (device) {
      this._currentDevice = device;
      this._resolveRequest(device);
    } else {
      this._rejectRequest(
        new DOMException("User cancelled the requestDevice() chooser.", "NotFoundError")
      );
    }
  }
}

const mock = new BluetoothMock();
Object.defineProperty(navigator, "bluetooth", { value: mock, configurable: true });
Object.defineProperty(navigator, "mockBluetooth", { value: mock });

// Expose dexie db
Object.defineProperty(window, "appDb", { value: db });
