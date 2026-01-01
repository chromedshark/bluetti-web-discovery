/**
 * Manual test page application logic.
 */
import { BluetoothClient, createKeyBundle, parseRegisterData, registerToUint16 } from "./main.ts";

declare module "bun" {
  interface Env {
    KEY_BUNDLE_SIGNING_KEY: string;
    KEY_BUNDLE_VERIFY_KEY: string;
    KEY_BUNDLE_SHARED_SECRET: string;
  }
}

let client: BluetoothClient | null = null;

const status = document.getElementById("status")!;
const output = document.getElementById("output")!;
const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement;
const disconnectBtn = document.getElementById("disconnectBtn") as HTMLButtonElement;
const readBtn = document.getElementById("readBtn") as HTMLButtonElement;
const startAddrInput = document.getElementById("startAddr") as HTMLInputElement;
const countInput = document.getElementById("count") as HTMLInputElement;

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

function updateStatus(): void {
  if (client?.isConnected) {
    status.textContent = `Connected: ${client.deviceName || "Unknown"}`;
    status.className = "connected";
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    readBtn.disabled = false;
  } else {
    status.textContent = "Disconnected";
    status.className = "disconnected";
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    readBtn.disabled = true;
  }
}

connectBtn.addEventListener("click", async () => {
  try {
    log("Requesting device...");
    client = await BluetoothClient.request(keyBundle);
    log(`Selected: ${client.deviceName}`);

    log("Connecting...");
    await client.connect();
    log(`Connected to: ${client.deviceName}`);
    updateStatus();

    // Load protocol version. Encrypted devices appear to expect polling after
    // handshake completion, or they re-notify that the handshake is done.
    const registers = await client.readRegisters(16, 1);
    log(`Protocol version: ${registerToUint16(registers)}`);
  } catch (error) {
    log(`Error: ${(error as Error).message}`);
  }
});

disconnectBtn.addEventListener("click", () => {
  client?.disconnect();
  log("Disconnected");
  updateStatus();
});

readBtn.addEventListener("click", async () => {
  if (!client) {
    log("No device selected");
    return;
  }

  const startAddr = parseInt(startAddrInput.value, 10);
  const count = parseInt(countInput.value, 10);

  if (isNaN(startAddr) || isNaN(count) || count < 1 || count > 7) {
    log("Invalid input: start address must be a number, count must be 1-7");
    return;
  }

  try {
    log(`Reading ${count} registers from address ${startAddr}...`);

    const data = await client.readRegisters(startAddr, count);

    const registers = parseRegisterData(startAddr, data);
    for (const reg of registers) {
      const uint16 = registerToUint16(reg.value);
      const hex = Array.from(reg.value)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
      log(`  [${reg.address}] = ${uint16} (0x${hex})`);
    }

    log("Read complete");
  } catch (error) {
    log(`Error: ${(error as Error).message}`);
  }
});

// Initial status update
updateStatus();
log("Ready. Click 'Connect to Device' to start.");
