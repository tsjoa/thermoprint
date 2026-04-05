import type { BleTransport, BlePeripheral, ScanOptions, ScanHandle } from "./transport/types.js";
import { findDevice } from "./device/registry.js";

export interface DiscoverOptions extends ScanOptions {
  timeoutMs?: number;
  maxResults?: number;
}

/**
 * Discover a single supported printer.
 * Returns the first peripheral whose name matches a registered device profile.
 */
export async function discover(
  transport: BleTransport,
  options: DiscoverOptions = {},
): Promise<BlePeripheral> {
  const { timeoutMs = 10000, ...scanOptions } = options;

  return new Promise<BlePeripheral>(async (resolve, reject) => {
    let resolved = false;

    let handle: ScanHandle;
    try {
      handle = await transport.scan((peripheral) => {
        if (resolved) return;
        if (findDevice(peripheral)) {
          resolved = true;
          clearTimeout(timer);
          handle.stop().then(() => resolve(peripheral));
        }
      }, scanOptions);
    } catch (err) {
      reject(err);
      return;
    }

    const timer = setTimeout(async () => {
      if (resolved) return;
      resolved = true;
      await handle.stop();
      reject(new Error("Discovery timeout: no supported printer found"));
    }, timeoutMs);
  });
}

/**
 * Discover all supported printers within the timeout period.
 */
export async function discoverAll(
  transport: BleTransport,
  options: DiscoverOptions = {},
): Promise<BlePeripheral[]> {
  const { timeoutMs = 10000, maxResults, ...scanOptions } = options;
  const found: BlePeripheral[] = [];
  const seen = new Set<string>();

  return new Promise<BlePeripheral[]>(async (resolve, reject) => {
    let resolved = false;

    let handle: ScanHandle;
    try {
      handle = await transport.scan((peripheral) => {
        if (resolved) return;
        if (seen.has(peripheral.id)) return;
        seen.add(peripheral.id);

        if (findDevice(peripheral)) {
          found.push(peripheral);
          if (maxResults && found.length >= maxResults) {
            resolved = true;
            clearTimeout(timer);
            handle.stop().then(() => resolve(found));
          }
        }
      }, scanOptions);
    } catch (err) {
      reject(err);
      return;
    }

    const timer = setTimeout(async () => {
      if (resolved) return;
      resolved = true;
      await handle.stop();
      resolve(found);
    }, timeoutMs);
  });
}
