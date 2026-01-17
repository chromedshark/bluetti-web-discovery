import { db, type DeviceRecord } from "./db.ts";

/**
 * Service for managing device records in the database.
 */
export const deviceService = {
  /**
   * Get or create a device record.
   * If a device with the same ID exists, it will be updated.
   */
  async upsertDevice(device: Omit<DeviceRecord, "id"> & { id: string }): Promise<DeviceRecord> {
    await db.devices.put(device);
    return device;
  },

  /**
   * Get a device by ID.
   */
  async getDevice(id: string): Promise<DeviceRecord | undefined> {
    return db.devices.get(id);
  },

  /**
   * Get all devices.
   */
  async getAllDevices(): Promise<DeviceRecord[]> {
    return db.devices.toArray();
  },

  /**
   * Delete a device and all its scan results.
   */
  async deleteDevice(id: string): Promise<void> {
    await db.transaction("rw", [db.devices, db.scanResults], async () => {
      await db.scanResults.where("deviceId").equals(id).delete();
      await db.devices.delete(id);
    });
  },
};
