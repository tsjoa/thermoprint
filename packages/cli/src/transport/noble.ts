import { createBluetooth } from "node-ble";
import type {
  BleTransport,
  BleConnection,
  BleService,
  BleCharacteristic,
  BlePeripheral,
  ScanOptions,
  ScanHandle,
} from "@thermoprint/core";

// Singleton D-Bus connection — BlueZ on Linux, no privileges needed.
let _bt: ReturnType<typeof createBluetooth> | null = null;
function getBt() {
  if (!_bt) _bt = createBluetooth();
  return _bt;
}
process.on("exit", () => { try { _bt?.destroy(); } catch {} });

async function getAdapter() {
  return getBt().bluetooth.defaultAdapter();
}

// BlueZ returns full UUIDs with dashes (lowercase). Normalize for comparison.
function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

class DbusCharacteristic implements BleCharacteristic {
  constructor(private readonly char: any) {}

  async write(data: Uint8Array, withoutResponse: boolean): Promise<void> {
    const buf = Buffer.from(data);
    if (withoutResponse) {
      await this.char.writeValueWithoutResponse(buf);
    } else {
      await this.char.writeValueWithResponse(buf);
    }
  }

  async subscribe(listener: (data: Uint8Array) => void): Promise<void> {
    this.char.on("valuechanged", (buf: Buffer) => listener(new Uint8Array(buf)));
    await this.char.startNotifications();
  }

  async unsubscribe(): Promise<void> {
    await this.char.stopNotifications().catch(() => {});
    this.char.removeAllListeners("valuechanged");
  }
}

class DbusService implements BleService {
  constructor(private readonly service: any) {}

  async getCharacteristic(uuid: string): Promise<BleCharacteristic | null> {
    try {
      // BlueZ uses lowercase full UUIDs as keys; normalize our input to match.
      const allUuids: string[] = await this.service.characteristics();
      const target = normalizeUuid(uuid);
      const match = allUuids.find((u) => normalizeUuid(u) === target);
      if (!match) return null;
      const char = await this.service.getCharacteristic(match);
      return new DbusCharacteristic(char);
    } catch {
      return null;
    }
  }
}

class DbusConnection implements BleConnection {
  private _connected = true;

  constructor(
    private readonly device: any,
    private readonly gattServer: any,
  ) {
    device.on("disconnect", () => { this._connected = false; });
  }

  async discoverService(uuid: string): Promise<BleService | null> {
    try {
      const allServices: string[] = await this.gattServer.services();
      const target = normalizeUuid(uuid);
      const match = allServices.find((u) => normalizeUuid(u) === target);
      if (!match) return null;
      const service = await this.gattServer.getPrimaryService(match);
      return new DbusService(service);
    } catch {
      return null;
    }
  }

  async disconnect(): Promise<void> {
    if (this._connected) {
      this._connected = false;
      await this.device.disconnect().catch(() => {});
    }
  }

  get isConnected(): boolean {
    return this._connected;
  }
}

export class NobleBleTransport implements BleTransport {
  async scan(
    onDiscover: (peripheral: BlePeripheral) => void,
    options?: ScanOptions,
  ): Promise<ScanHandle> {
    const adapter = await getAdapter();
    const wasDiscovering = await adapter.isDiscovering();
    if (!wasDiscovering) await adapter.startDiscovery();

    const seen = new Set<string>();
    const namePrefix = options?.namePrefix;
    let stopped = false;

    const processAddress = async (address: string) => {
      if (seen.has(address)) return;
      seen.add(address);
      try {
        const device = await adapter.getDevice(address);
        const name: string = await device.getName().catch(() => "");
        if (namePrefix && !name.startsWith(namePrefix)) return;
        const rssi = Number(await device.getRSSI().catch(() => -100));
        const uuids: string[] = await (device as any).helper
          .prop("UUIDs")
          .catch(() => []);
        onDiscover({ id: address, name: name ?? "", rssi, serviceUuids: uuids ?? [] });
      } catch {
        // device not yet accessible, skip
      }
    };

    // Poll for new devices every 500 ms (node-ble Adapter has no 'device' event)
    const poll = setInterval(async () => {
      if (stopped) return;
      for (const addr of await adapter.devices()) processAddress(addr);
    }, 500);

    // Process already-known devices immediately
    for (const addr of await adapter.devices()) processAddress(addr);

    return {
      stop: async () => {
        stopped = true;
        clearInterval(poll);
        if (!wasDiscovering) await adapter.stopDiscovery().catch(() => {});
      },
    };
  }

  async scanForAddress(address: string, timeoutMs: number): Promise<BlePeripheral> {
    const adapter = await getAdapter();
    const wasDiscovering = await adapter.isDiscovering();
    if (!wasDiscovering) await adapter.startDiscovery();

    try {
      const device = await adapter.waitDevice(address, timeoutMs);
      const name: string = await device.getName().catch(() => "");
      const rssi = Number(await device.getRSSI().catch(() => -100));
      const uuids: string[] = await (device as any).helper
        .prop("UUIDs")
        .catch(() => []);
      return { id: address, name: name ?? "", rssi, serviceUuids: uuids ?? [] };
    } finally {
      if (!wasDiscovering) await adapter.stopDiscovery().catch(() => {});
    }
  }

  async connect(peripheral: BlePeripheral): Promise<BleConnection> {
    const adapter = await getAdapter();
    const adapterName: string = (adapter as any).adapter; // e.g. "hci0"

    // Remove any stale BlueZ cache entry for this device. BlueZ tracks
    // "PreferredBearer" and will try BR/EDR if the device was previously
    // seen without LE-only flags (advertising flags 0x02 vs 0x06).
    const serialized = `dev_${peripheral.id.replace(/:/g, "_").toUpperCase()}`;
    const devicePath = `/org/bluez/${adapterName}/${serialized}`;
    await (adapter as any).helper
      .callMethod("RemoveDevice", devicePath)
      .catch(() => {}); // ignore if not cached

    // Start LE-filtered discovery so BlueZ re-classifies the device as LE.
    const wasDiscovering = await adapter.isDiscovering();
    if (!wasDiscovering) await adapter.startDiscovery();

    // Wait for the device to appear in the LE-filtered cache.
    await adapter.waitDevice(peripheral.id, 10000);

    // Stop discovery before connecting (BlueZ may reject connect while scanning).
    if (!wasDiscovering) await adapter.stopDiscovery().catch(() => {});

    const device = await adapter.getDevice(peripheral.id);
    await device.connect();

    // Wait for BlueZ to finish GATT service discovery (ServicesResolved).
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const resolved: boolean = await (device as any).helper
        .prop("ServicesResolved")
        .catch(() => false);
      if (resolved) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    const gatt = await device.gatt();
    return new DbusConnection(device, gatt);
  }
}
