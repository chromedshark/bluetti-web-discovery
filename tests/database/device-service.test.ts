import { describe, test, expect, beforeEach } from "bun:test";
import { db } from "../../src/database/db.ts";
import { deviceService } from "../../src/database/device-service.ts";

describe("deviceService", () => {
  beforeEach(async () => {
    // Clear database between tests
    await db.devices.clear();
    await db.scanResults.clear();
  });

  describe("upsertDevice", () => {
    test("creates a new device", async () => {
      const device = {
        id: "device-1",
        name: "AC300Test",
        protocolVersion: 1050,
        deviceType: "AC300",
      };

      const result = await deviceService.upsertDevice(device);

      expect(result).toEqual(device);

      const stored = await db.devices.get("device-1");
      expect(stored).toEqual(device);
    });

    test("updates an existing device", async () => {
      const device = {
        id: "device-1",
        name: "AC300Test",
        protocolVersion: 1050,
        deviceType: "AC300",
      };
      await deviceService.upsertDevice(device);

      const updated = {
        ...device,
        name: "AC300Updated",
        protocolVersion: 2000,
      };
      await deviceService.upsertDevice(updated);

      const stored = await db.devices.get("device-1");
      expect(stored?.name).toBe("AC300Updated");
      expect(stored?.protocolVersion).toBe(2000);

      // Should still be only one device
      const count = await db.devices.count();
      expect(count).toBe(1);
    });
  });

  describe("getDevice", () => {
    test("returns device by id", async () => {
      const device = {
        id: "device-1",
        name: "AC300Test",
        protocolVersion: 1050,
        deviceType: "AC300",
      };
      await db.devices.add(device);

      const result = await deviceService.getDevice("device-1");

      expect(result).toEqual(device);
    });

    test("returns undefined for unknown id", async () => {
      const result = await deviceService.getDevice("unknown");

      expect(result).toBeUndefined();
    });
  });

  describe("getAllDevices", () => {
    test("returns all devices", async () => {
      const device1 = {
        id: "device-1",
        name: "AC300Test",
        protocolVersion: 1050,
        deviceType: "AC300",
      };
      const device2 = {
        id: "device-2",
        name: "AC500Test",
        protocolVersion: 2000,
        deviceType: "AC500",
      };
      await db.devices.bulkAdd([device1, device2]);

      const result = await deviceService.getAllDevices();

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(device1);
      expect(result).toContainEqual(device2);
    });

    test("returns empty array when no devices", async () => {
      const result = await deviceService.getAllDevices();

      expect(result).toEqual([]);
    });
  });

  describe("deleteDevice", () => {
    test("deletes device and its scan results", async () => {
      const device = {
        id: "device-1",
        name: "AC300Test",
        protocolVersion: 1050,
        deviceType: "AC300",
      };
      await db.devices.add(device);

      // Add some scan results for this device
      await db.scanResults.bulkAdd([
        {
          deviceId: "device-1",
          register: 0,
          readable: true,
          scannedAt: new Date(),
          value: new Uint8Array([0x00, 0x01]),
        },
        {
          deviceId: "device-1",
          register: 1,
          readable: true,
          scannedAt: new Date(),
          value: new Uint8Array([0x00, 0x02]),
        },
      ]);

      await deviceService.deleteDevice("device-1");

      const storedDevice = await db.devices.get("device-1");
      expect(storedDevice).toBeUndefined();

      const scanResults = await db.scanResults.where("deviceId").equals("device-1").toArray();
      expect(scanResults).toHaveLength(0);
    });

    test("does not affect other devices", async () => {
      await db.devices.bulkAdd([
        {
          id: "device-1",
          name: "AC300Test",
          protocolVersion: 1050,
          deviceType: "AC300",
        },
        {
          id: "device-2",
          name: "AC500Test",
          protocolVersion: 2000,
          deviceType: "AC500",
        },
      ]);

      await db.scanResults.bulkAdd([
        {
          deviceId: "device-1",
          register: 0,
          readable: true,
          scannedAt: new Date(),
          value: new Uint8Array([0x00, 0x01]),
        },
        {
          deviceId: "device-2",
          register: 0,
          readable: true,
          scannedAt: new Date(),
          value: new Uint8Array([0x00, 0x02]),
        },
      ]);

      await deviceService.deleteDevice("device-1");

      const device2 = await db.devices.get("device-2");
      expect(device2).toBeDefined();

      const device2Results = await db.scanResults.where("deviceId").equals("device-2").toArray();
      expect(device2Results).toHaveLength(1);
    });
  });
});
