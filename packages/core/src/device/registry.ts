import type { DeviceProfile } from "./types.js";
import type { BlePeripheral } from "../transport/types.js";
import { p15Profile } from "./profiles/p15.js";
import { p12Profile } from "./profiles/p12.js";

const devices: DeviceProfile[] = [];

export function registerDevice(profile: DeviceProfile): void {
  devices.push(profile);
}

export function findDeviceByName(name: string): DeviceProfile | null {
  for (const profile of devices) {
    for (const prefix of profile.namePrefixes) {
      if (name.startsWith(prefix)) {
        return profile;
      }
    }
  }
  return null;
}

function normalizeUuid(uuid: string): string {
  const s = uuid.replace(/-/g, "").toLowerCase();
  // Bluetooth base UUID short form: "0000ff00-0000-1000-8000-00805f9b34fb" → "ff00"
  if (s.length === 32 && s.startsWith("0000") && s.slice(8) === "00001000800000805f9b34fb") {
    return s.slice(4, 8);
  }
  return s;
}

export function findDevice(peripheral: BlePeripheral): DeviceProfile | null {
  if (peripheral.name) {
    const byName = findDeviceByName(peripheral.name);
    if (byName) return byName;
  }
  for (const profile of devices) {
    const profileUuids = new Set([
      normalizeUuid(profile.serviceUuid),
      ...(profile.advertisedUuids ?? []).map(normalizeUuid),
    ]);
    for (const uuid of peripheral.serviceUuids) {
      if (profileUuids.has(normalizeUuid(uuid))) return profile;
    }
  }
  return null;
}

export function getDevice(modelId: string): DeviceProfile | null {
  return devices.find((d) => d.modelId === modelId) ?? null;
}

export function getRegisteredDevices(): DeviceProfile[] {
  return [...devices];
}

// Register built-in devices
registerDevice(p15Profile);
registerDevice(p12Profile);
