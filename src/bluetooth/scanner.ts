/**
 * Bluetti Web Bluetooth Scanner
 *
 * This module provides functions for discovering Bluetti devices
 * using the Web Bluetooth API.
 */

/** The GATT service UUID used by all Bluetti devices */
export const BLUETTI_SERVICE_UUID = 0xff00;

/**
 * Request a Bluetti device from the user via the Web Bluetooth API.
 *
 * This triggers the browser's device picker dialog filtered to show
 * only devices advertising the Bluetti service UUID.
 *
 * @returns The selected BluetoothDevice
 * @throws DOMException if the user cancels or no device is found
 */
export async function requestBluettiDevice(): Promise<BluetoothDevice> {
  return navigator.bluetooth.requestDevice({
    filters: [{ services: [BLUETTI_SERVICE_UUID] }],
  });
}
