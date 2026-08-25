/**
 * BLE transport using bluepy-helper (the same C binary used by the Python bluepy library).
 * This does raw HCI LE connections, bypassing BlueZ's profile system entirely — which is
 * why it works for dual-mode printers that BlueZ mis-classifies as BR/EDR.
 */

import { spawn } from "child_process";
import * as readline from "readline";
import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type {
  BleTransport,
  BleConnection,
  BleService,
  BleCharacteristic,
  BlePeripheral,
  ScanOptions,
  ScanHandle,
} from "@thermoprint/core";

// ---------------------------------------------------------------------------
// Find bluepy-helper binary
// ---------------------------------------------------------------------------

function findInVenv(startDir: string): string | null {
  let curr = startDir;
  while (curr && curr !== "/" && curr !== ".") {
    const venv = path.join(curr, ".venv");
    if (fs.existsSync(venv)) {
      try {
        const matches = child_process
          .execSync(`find "${venv}" -name "bluepy-helper" 2>/dev/null`, {
            encoding: "utf-8",
          })
          .trim()
          .split("\n");
        for (const m of matches) {
          if (m && fs.existsSync(m)) return m;
        }
      } catch {}
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return null;
}

function findBluepyHelper(): string {
  // Check environment override first
  if (process.env.BLUEPY_HELPER) return process.env.BLUEPY_HELPER;

  // Try to find via uv/python in CWD
  try {
    const out = child_process
      .execSync(
        "uv run python3 -c \"import bluepy, os; print(os.path.join(os.path.dirname(bluepy.__file__), 'bluepy-helper'))\"",
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
      )
      .trim();
    if (out && fs.existsSync(out)) return out;
  } catch {}

  // Search parent directories from source file location and CWD for .venv
  try {
    const srcDir = path.dirname(fileURLToPath(import.meta.url));
    const foundFromSrc = findInVenv(srcDir);
    if (foundFromSrc) return foundFromSrc;

    const foundFromCwd = findInVenv(process.cwd());
    if (foundFromCwd) return foundFromCwd;
  } catch {}

  // Fallback: common system locations
  const candidates = [
    "/usr/lib/python3/dist-packages/bluepy/bluepy-helper",
    "/usr/local/lib/python3.12/dist-packages/bluepy/bluepy-helper",
    "/usr/local/lib/python3.13/dist-packages/bluepy/bluepy-helper",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  throw new Error(
    "bluepy-helper not found. Install bluepy: pip install bluepy  (or set BLUEPY_HELPER env var)",
  );
}

let _helperPath: string | null = null;
function getHelperPath(): string {
  if (!_helperPath) _helperPath = findBluepyHelper();
  return _helperPath;
}

// ---------------------------------------------------------------------------
// Protocol helpers
// ---------------------------------------------------------------------------

type BluepyValue = string | number | Buffer | null;
type BluepyResp = Record<string, BluepyValue[]>;

function parseResp(line: string): BluepyResp {
  const resp: BluepyResp = {};
  for (const item of line.trim().split("\x1e")) {
    const eqIdx = item.indexOf("=");
    if (eqIdx < 0) continue;
    const tag = item.slice(0, eqIdx);
    const tval = item.slice(eqIdx + 1);
    let val: BluepyValue;
    if (tval.length === 0) {
      val = null;
    } else if (tval[0] === "$" || tval[0] === "'") {
      val = tval.slice(1);
    } else if (tval[0] === "h") {
      val = parseInt(tval.slice(1), 16);
    } else if (tval[0] === "b") {
      val = Buffer.from(tval.slice(1), "hex");
    } else {
      continue;
    }
    if (!(tag in resp)) resp[tag] = [];
    resp[tag].push(val);
  }
  return resp;
}

function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// BluepySession — wraps a single bluepy-helper process
// ---------------------------------------------------------------------------

class BluepySession {
  private proc: ReturnType<typeof spawn>;
  private rl: readline.Interface;
  private pending: Array<{
    type: string;
    resolve: (resp: BluepyResp) => void;
    reject: (err: Error) => void;
  }> = [];
  private notifyListeners = new Map<number, (data: Uint8Array) => void>();
  private dead = false;
  private stderrOutput = "";

  constructor(helperPath: string) {
    this.proc = spawn(helperPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.rl = readline.createInterface({ input: this.proc.stdout! });
    this.rl.on("line", (line) => this.handleLine(line));
    this.proc.stderr?.on("data", (data) => {
      this.stderrOutput += data.toString();
    });
    this.proc.on("exit", () => this.handleExit());
  }

  private handleLine(line: string): void {
    if (!line.trim() || line.startsWith("#")) return;
    let resp: BluepyResp;
    try {
      resp = parseResp(line);
    } catch {
      return;
    }

    const type = resp["rsp"]?.[0] as string;

    if (type === "ntfy" || type === "ind") {
      const hnd = resp["hnd"]?.[0] as number;
      const data = resp["d"]?.[0] as Buffer;
      if (hnd !== undefined && data !== undefined) {
        this.notifyListeners.get(hnd)?.(new Uint8Array(data));
      }
      return;
    }

    if (type === "stat") {
      const state = resp["state"]?.[0] as string;
      if (state === "disc") {
        this.handleExit();
        return;
      }
    }

    if (type === "err") {
      const code = resp["code"]?.[0] as string;
      const err = new Error(`bluepy-helper error: ${code}`);
      const waiter = this.pending.shift();
      if (waiter) waiter.reject(err);
      return;
    }

    const waiter = this.pending.shift();
    if (waiter) {
      if (waiter.type === type || waiter.type === "*") {
        waiter.resolve(resp);
      } else {
        // Wrong type — put it back and resolve with whatever came
        this.pending.unshift(waiter);
        waiter.resolve(resp);
      }
    }
  }

  private handleExit(): void {
    if (this.dead) return;
    this.dead = true;
    const stderrMsg = this.stderrOutput.trim() ? `: ${this.stderrOutput.trim()}` : "";
    const err = new Error(`bluepy-helper exited${stderrMsg}`);
    for (const w of this.pending) w.reject(err);
    this.pending = [];
  }

  private send(cmd: string): void {
    this.proc.stdin!.write(cmd + "\n");
  }

  private waitFor(type: string, timeoutMs = 10000): Promise<BluepyResp> {
    return new Promise((resolve, reject) => {
      if (this.dead) {
        const stderrMsg = this.stderrOutput.trim() ? `: ${this.stderrOutput.trim()}` : "";
        return reject(new Error(`bluepy-helper not running${stderrMsg}`));
      }
      const timer = setTimeout(() => {
        const idx = this.pending.findIndex((p) => p.resolve === resolveWrapped);
        if (idx !== -1) this.pending.splice(idx, 1);
        reject(new Error(`Timeout waiting for ${type} from bluepy-helper`));
      }, timeoutMs);
      const resolveWrapped = (resp: BluepyResp) => {
        clearTimeout(timer);
        resolve(resp);
      };
      const rejectWrapped = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };
      this.pending.push({ type, resolve: resolveWrapped, reject: rejectWrapped });
    });
  }

  async connect(address: string, addrType: string = "public"): Promise<void> {
    this.send(`conn ${address} ${addrType}`);
    const resp = await this.waitFor("stat", 15000);
    let state = resp["state"]?.[0] as string;
    while (state === "tryconn") {
      const next = await this.waitFor("stat", 15000);
      state = next["state"]?.[0] as string;
    }
    if (state !== "conn") {
      throw new Error(`Failed to connect to ${address} (${addrType}), state: ${state}`);
    }
    // Set MTU to 100 (0x64) — matches Python's peripheral.setMTU(100).
    // Without this the default BLE MTU is 23 and 96-byte writes get truncated.
    this.send("mtu 64");
    await this.waitFor("stat", 5000);
  }

  async discoverCharacteristics(): Promise<
    Array<{ declHandle: number; uuid: string; props: number; valueHandle: number }>
  > {
    this.send("char 1 FFFF");
    const resp = await this.waitFor("find", 10000);
    const hnds = (resp["hnd"] ?? []) as number[];
    const uuids = (resp["uuid"] ?? []) as string[];
    const props = (resp["props"] ?? []) as number[];
    const vhnds = (resp["vhnd"] ?? []) as number[];
    return hnds.map((hnd, i) => ({
      declHandle: hnd,
      uuid: normalizeUuid(String(uuids[i] ?? "")),
      props: props[i] ?? 0,
      valueHandle: vhnds[i] ?? hnd,
    }));
  }

  async write(valueHandle: number, data: Uint8Array, withResponse: boolean): Promise<void> {
    const hex = Buffer.from(data).toString("hex");
    if (withResponse) {
      this.send(`wrr ${valueHandle.toString(16)} ${hex}`);
      await this.waitFor("wrr", 5000);
    } else {
      this.send(`wr ${valueHandle.toString(16)} ${hex}`);
    }
  }

  onNotify(valueHandle: number, listener: (data: Uint8Array) => void): void {
    this.notifyListeners.set(valueHandle, listener);
  }

  offNotify(valueHandle: number): void {
    this.notifyListeners.delete(valueHandle);
  }

  async enableNotify(ccdHandle: number): Promise<void> {
    await this.write(ccdHandle, new Uint8Array([0x01, 0x00]), true);
  }

  async disableNotify(ccdHandle: number): Promise<void> {
    await this.write(ccdHandle, new Uint8Array([0x00, 0x00]), true).catch(() => {});
  }

  disconnect(): void {
    if (!this.dead) {
      this.dead = true;
      try { this.proc.stdin!.end(); } catch {}
      try { this.proc.kill(); } catch {}
    }
  }
}

// ---------------------------------------------------------------------------
// BleCharacteristic / BleService / BleConnection via bluepy
// ---------------------------------------------------------------------------

class BluepyCharacteristic implements BleCharacteristic {
  constructor(
    private readonly session: BluepySession,
    private readonly valueHandle: number,
    // CCD (notify enable) descriptor is typically at valueHandle+1
    private readonly ccdHandle: number,
  ) {}

  async write(data: Uint8Array, withoutResponse: boolean): Promise<void> {
    await this.session.write(this.valueHandle, data, !withoutResponse);
  }

  async subscribe(listener: (data: Uint8Array) => void): Promise<void> {
    this.session.onNotify(this.valueHandle, listener);
    await this.session.enableNotify(this.ccdHandle).catch(() => {
      // CCD might not be at handle+1; notifications still registered
    });
  }

  async unsubscribe(): Promise<void> {
    await this.session.disableNotify(this.ccdHandle).catch(() => {});
    this.session.offNotify(this.valueHandle);
  }
}

class BluepyService implements BleService {
  constructor(
    private readonly session: BluepySession,
    private readonly chars: Array<{
      uuid: string;
      valueHandle: number;
    }>,
  ) {}

  async getCharacteristic(uuid: string): Promise<BleCharacteristic | null> {
    const target = normalizeUuid(uuid);
    const found = this.chars.find((c) => c.uuid === target);
    if (!found) return null;
    return new BluepyCharacteristic(this.session, found.valueHandle, found.valueHandle + 1);
  }
}

class BluepyConnection implements BleConnection {
  private _connected = true;

  constructor(
    private readonly session: BluepySession,
    private readonly allChars: Array<{ uuid: string; valueHandle: number }>,
  ) {}

  async discoverService(_uuid: string): Promise<BleService | null> {
    // bluepy-helper discovers characteristics, not services explicitly.
    // We expose all characteristics under any service UUID.
    return new BluepyService(this.session, this.allChars);
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this.session.disconnect();
  }

  get isConnected(): boolean {
    return this._connected;
  }
}

// ---------------------------------------------------------------------------
// BleTransport
// ---------------------------------------------------------------------------

export class BluepyBleTransport implements BleTransport {
  async scan(
    onDiscover: (peripheral: BlePeripheral) => void,
    options?: ScanOptions,
  ): Promise<ScanHandle> {
    // TODO: implement full scan via bluepy-helper if needed
    throw new Error("BluepyBleTransport.scan() not implemented — use -a/--address flag");
  }

  async scanForAddress(address: string, _timeoutMs: number): Promise<BlePeripheral> {
    // We know the address; return a minimal peripheral so Printer.connect can
    // match it by the P15 advertised UUID.
    return {
      id: address,
      name: "",
      rssi: -100,
      serviceUuids: ["e7810a7173ae499d8c15faa9aef0c3f2"],
    };
  }

  async connect(peripheral: BlePeripheral): Promise<BleConnection> {
    const helperPath = getHelperPath();
    const session = new BluepySession(helperPath);
    await session.connect(peripheral.id);
    const chars = await session.discoverCharacteristics();
    return new BluepyConnection(session, chars);
  }
}
