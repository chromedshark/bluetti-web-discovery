/**
 * Manual test page application logic.
 */
import { BluetoothClient, createKeyBundle, parseRegisterData, splitRanges } from "./main.ts";

declare module "bun" {
  interface Env {
    KEY_BUNDLE_SIGNING_KEY: string;
    KEY_BUNDLE_VERIFY_KEY: string;
    KEY_BUNDLE_SHARED_SECRET: string;
  }
}

interface ReadallData {
  name: string;
  iotVersion: number;
  protocolVersion: number;
  encryption: boolean;
  registers: Map<number, string>;
}

let client: BluetoothClient | null = null;
let scanData: ReadallData | null = null;
let stopScan = false;

const output = document.getElementById("output")!;
const scanBtn = document.getElementById("scanBtn") as HTMLButtonElement;
const downloadBtn = document.getElementById("downloadBtn") as HTMLButtonElement;

const keyBundle = await createKeyBundle(
  process.env.KEY_BUNDLE_SIGNING_KEY,
  process.env.KEY_BUNDLE_VERIFY_KEY,
  process.env.KEY_BUNDLE_SHARED_SECRET
);

function log(message: string): void {
  const timestamp = new Date().toISOString().slice(11, 23);
  output.textContent += `[${timestamp}] ${message}\n`;
  output.scrollTop = output.scrollHeight;
}

scanBtn.addEventListener("click", async () => {
  if (client) {
    stopScan = true;
    return;
  }

  try {
    log("Requesting device...");
    client = await BluetoothClient.request(keyBundle);
    log(`Selected: ${client.deviceName}`);

    log("Connecting...");
    await client.connect();
    log(
      `Connected to: ${client.deviceName} (${client.isEncrypted ? "encrypted" : "not encrypted"})`
    );

    // Load protocol version. Encrypted devices appear to expect polling after
    // handshake completion, or they re-notify that the handshake is done.
    const registers = await client.readRegisters(16, 1);
    const protocolVersion = new DataView(registers.buffer).getUint16(0, false);
    log(`Protocol version: ${protocolVersion}`);

    // Set up to stop scan
    stopScan = false;
    scanBtn.textContent = "Stop Scan";

    // Figure out what ranges we want to query. Stop before we get to the wifi
    // information. Use 5 address chunks so we're better aligned with the
    // decimal alignment that Bluetti seems to prefer for assigning addresses.
    // 5000 contains wifi usernames and passwords on v1 devices with wifi
    // 12000 contains wifi usernames and passwords on v2 devices with wifi
    const addressMax = protocolVersion < 2000 ? 4000 : 7000;
    const allRanges = splitRanges([{ start: 0, count: addressMax }], 5);

    // Build ReadallData
    const data: ReadallData = {
      name: client.deviceName || "",
      iotVersion: protocolVersion < 2000 ? 1 : 2,
      protocolVersion,
      encryption: client.isEncrypted,
      registers: new Map<number, string>(),
    };
    for (const range of allRanges) {
      if (stopScan) break;

      try {
        log(`Reading ${range.count} registers from address ${range.start}...`);
        const chunk = await client.readRegisters(range.start, range.count, { timeout: 1500 });
        const registers = parseRegisterData(range.start, chunk);
        for (const reg of registers) {
          log(`  [${reg.address}] = 0x${reg.value.toHex()}`);
          data.registers.set(reg.address, reg.value.toHex());
        }
      } catch (error) {
        log(`Error: ${(error as Error).message}`);
      } finally {
        // Wait a bit between requests
        await new Promise((resolve, _) => setTimeout(resolve, 100));
      }
    }
    scanData = data;
    downloadBtn.disabled = false;
    log(`Scan complete! You can now download the results above.`);
  } catch (error) {
    log(`Error: ${(error as Error).message}`);
  } finally {
    scanBtn.textContent = "Pick a Device and Scan";
    if (client) client.disconnect();
    client = null;
  }
});

downloadBtn.addEventListener("click", () => {
  if (!scanData) {
    alert("No scan data to download");
    return;
  }

  // Build JSON
  const { registers, ...rest } = scanData;
  const json = Object.assign({ registers: {} as Record<string, string> }, rest);
  for (const [key, value] of registers) {
    json.registers[key.toString()] = value;
  }

  // Prompt to download it
  const blob = new Blob([JSON.stringify(json)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url
  link.download = "bluetti_data.json";
  document.body.appendChild(link);
  link.click();

  // Clean up
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

// Initial status update
log("Ready. Click 'Pick a Device and Scan' to start.");
