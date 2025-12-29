import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

/**
 * Mock BluetoothDevice matching the Web Bluetooth API interface.
 * This is a minimal mock sufficient for testing requestDevice().
 */
interface MockBluetoothDevice {
  id: string;
  name: string | null;
  gatt?: {
    connected: boolean;
    connect: () => Promise<unknown>;
    disconnect: () => void;
  };
}

/**
 * Creates a mock BluetoothDevice with the given name.
 */
function createMockDevice(name: string): MockBluetoothDevice {
  return {
    id: `mock-device-${crypto.randomUUID()}`,
    name,
    gatt: {
      connected: false,
      connect: mock(() => Promise.resolve({})),
      disconnect: mock(() => undefined),
    },
  };
}

/**
 * Flexible options type for our mock - matches real API but allows type narrowing.
 */
interface MockRequestDeviceOptions {
  filters?: BluetoothLEScanFilter[];
  acceptAllDevices?: boolean;
  optionalServices?: BluetoothServiceUUID[];
}

/**
 * Mock implementation of navigator.bluetooth.
 * Returns devices that match the filter criteria.
 */
function createMockBluetooth(availableDevices: MockBluetoothDevice[]) {
  const requestDevice = mock(
    async (options?: MockRequestDeviceOptions): Promise<MockBluetoothDevice> => {
      // Validate options
      if (!options?.filters && !options?.acceptAllDevices) {
        throw new TypeError(
          "Failed to execute 'requestDevice' on 'Bluetooth': " +
            "Either filters or acceptAllDevices must be provided."
        );
      }

      if (options.acceptAllDevices && availableDevices.length > 0) {
        return availableDevices[0]!;
      }

      if (options.filters) {
        for (const filter of options.filters) {
          // Match by services (like the real Bluetti filter for 0xFF00)
          if (filter.services) {
            const matchingDevice = availableDevices.find(() => {
              // In a real implementation, we'd check if the device
              // advertises these services. For the mock, we assume all
              // mock devices match service filters.
              return true;
            });
            if (matchingDevice) {
              return matchingDevice;
            }
          }

          // Match by name prefix
          if (filter.namePrefix) {
            const matchingDevice = availableDevices.find(
              (device) => device.name?.startsWith(filter.namePrefix!) ?? false
            );
            if (matchingDevice) {
              return matchingDevice;
            }
          }

          // Match by exact name
          if (filter.name) {
            const matchingDevice = availableDevices.find((device) => device.name === filter.name);
            if (matchingDevice) {
              return matchingDevice;
            }
          }
        }
      }

      // No device found - simulate user cancellation
      throw new DOMException("User cancelled the requestDevice() chooser.", "NotFoundError");
    }
  );

  return {
    requestDevice,
    getAvailability: mock(async () => true),
    getDevices: mock(async () => availableDevices as unknown as BluetoothDevice[]),
  };
}

describe("navigator.bluetooth mock", () => {
  let originalBluetooth: Bluetooth | undefined;

  beforeEach(() => {
    // Store original navigator.bluetooth (if any)
    originalBluetooth = navigator.bluetooth;
  });

  afterEach(() => {
    // Restore original navigator.bluetooth
    if (originalBluetooth) {
      Object.defineProperty(navigator, "bluetooth", {
        value: originalBluetooth,
        writable: true,
        configurable: true,
      });
    }
  });

  test("can mock navigator.bluetooth.requestDevice to return a fake Bluetti device", async () => {
    // Arrange: Create a mock Bluetti device
    const mockBluettiDevice = createMockDevice("AC3001234567890");

    // Arrange: Install our mock bluetooth implementation
    const mockBluetooth = createMockBluetooth([mockBluettiDevice]);
    Object.defineProperty(navigator, "bluetooth", {
      value: mockBluetooth,
      writable: true,
      configurable: true,
    });

    // Act: Call requestDevice with the same filter as our index.html
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [0xff00] }],
    });

    // Assert: We got our mock device back
    expect(device).toBeDefined();
    expect(device.name).toBe("AC3001234567890");
    expect(device.id).toContain("mock-device-");

    // Assert: requestDevice was called with our filter
    expect(mockBluetooth.requestDevice).toHaveBeenCalledTimes(1);
    expect(mockBluetooth.requestDevice).toHaveBeenCalledWith({
      filters: [{ services: [0xff00] }],
    });
  });

  test("mock requestDevice throws NotFoundError when no device matches", async () => {
    // Arrange: Empty device list
    const mockBluetooth = createMockBluetooth([]);
    Object.defineProperty(navigator, "bluetooth", {
      value: mockBluetooth,
      writable: true,
      configurable: true,
    });

    // Act & Assert: Should throw NotFoundError
    await expect(
      navigator.bluetooth.requestDevice({
        filters: [{ services: [0xff00] }],
      })
    ).rejects.toThrow("User cancelled");
  });

  test("mock requestDevice throws TypeError when no filters provided", async () => {
    // Arrange
    const mockBluetooth = createMockBluetooth([]);
    Object.defineProperty(navigator, "bluetooth", {
      value: mockBluetooth,
      writable: true,
      configurable: true,
    });

    // Act & Assert: Should throw TypeError
    await expect(navigator.bluetooth.requestDevice({} as RequestDeviceOptions)).rejects.toThrow(
      "Either filters or acceptAllDevices must be provided"
    );
  });

  test("mock device can be connected to via GATT", async () => {
    // Arrange
    const mockDevice = createMockDevice("AC3001234567890");
    const mockBluetooth = createMockBluetooth([mockDevice]);
    Object.defineProperty(navigator, "bluetooth", {
      value: mockBluetooth,
      writable: true,
      configurable: true,
    });

    // Act
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [0xff00] }],
    });

    // Assert: GATT server is available
    expect(device.gatt).toBeDefined();
    expect(device.gatt?.connected).toBe(false);

    // Act: Connect to GATT
    await device.gatt?.connect();

    // Assert: Connect was called
    expect(device.gatt?.connect).toHaveBeenCalledTimes(1);
  });
});
