import { useCallback, useEffect, useState } from "react";
import { Bluetooth, BluetoothOff, Battery, Loader2, Server, Wifi, WifiOff } from "lucide-react";
import { usePrinterStore } from "../store/printer-store.ts";
import type { ConnectionMode } from "../store/printer-store.ts";
import { useWebBluetooth } from "../hooks/use-web-bluetooth.ts";
import { proxyStatus } from "../transport/proxy.ts";

function ModeToggle() {
  const mode = usePrinterStore((s) => s.connectionMode);
  const isConnected = usePrinterStore((s) => s.isConnected);

  const setMode = (m: ConnectionMode) => {
    if (isConnected) return; // don't switch while connected
    usePrinterStore.getState().setConnectionMode(m);
    usePrinterStore.getState().setError(null);
  };

  return (
    <div className="flex rounded border border-gray-300 dark:border-gray-600 text-xs overflow-hidden">
      <button
        onClick={() => setMode("proxy")}
        className={`flex items-center gap-1 px-2 py-1 ${
          mode === "proxy"
            ? "bg-blue-600 text-white"
            : "hover:bg-gray-100 dark:hover:bg-gray-700"
        } ${isConnected ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        <Server size={12} />
        Local
      </button>
      <button
        onClick={() => setMode("bluetooth")}
        className={`flex items-center gap-1 px-2 py-1 ${
          mode === "bluetooth"
            ? "bg-blue-600 text-white"
            : "hover:bg-gray-100 dark:hover:bg-gray-700"
        } ${isConnected ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        <Bluetooth size={12} />
        BLE
      </button>
    </div>
  );
}

function ProxyPanel() {
  const { isConnected, error } = usePrinterStore();
  const [checking, setChecking] = useState(false);

  const checkAndConnect = useCallback(async () => {
    setChecking(true);
    usePrinterStore.getState().setError(null);
    try {
      const info = await proxyStatus();
      usePrinterStore.getState().setConnected(true);
      usePrinterStore.getState().setPeripheral({
        id: info.address,
        name: `Proxy (${info.address})`,
        rssi: 0,
        serviceUuids: [],
      });
    } catch {
      usePrinterStore.getState().setError(
        "Cannot reach print server. Run: thermoprint serve",
      );
    } finally {
      setChecking(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    usePrinterStore.getState().setConnected(false);
    usePrinterStore.getState().setPeripheral(null);
  }, []);

  // Auto-check on mount
  useEffect(() => {
    checkAndConnect();
  }, [checkAndConnect]);

  return (
    <>
      {isConnected ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-sm">
            <Wifi size={14} className="text-green-500" />
            <span className="truncate">Local print server</span>
          </div>
          <button
            onClick={disconnect}
            className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          onClick={checkAndConnect}
          disabled={checking}
          className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {checking ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <WifiOff size={14} />
          )}
          {checking ? "Checking..." : "Connect to Server"}
        </button>
      )}
      {error && (
        <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded p-1.5">
          {error}
        </div>
      )}
    </>
  );
}

function BluetoothPanel() {
  const { peripheral, isConnected, isConnecting, isScanning, battery, error } =
    usePrinterStore();
  const { scan, connect, disconnect } = useWebBluetooth();

  const handleScan = async () => {
    await scan();
    const p = usePrinterStore.getState().peripheral;
    if (p && !usePrinterStore.getState().isConnected) {
      await connect(p);
    }
  };

  return (
    <>
      {isConnected ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-sm">
            <Bluetooth size={14} className="text-blue-500" />
            <span className="truncate">
              {peripheral?.name ?? "Connected"}
            </span>
          </div>
          {battery >= 0 && (
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <Battery size={12} />
              <span>{battery}%</span>
            </div>
          )}
          <button
            onClick={disconnect}
            className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          onClick={handleScan}
          disabled={isScanning || isConnecting}
          className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isScanning || isConnecting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <BluetoothOff size={14} />
          )}
          {isScanning
            ? "Scanning..."
            : isConnecting
              ? "Connecting..."
              : "Connect Printer"}
        </button>
      )}
      {error && (
        <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded p-1.5">
          {error}
        </div>
      )}
    </>
  );
}

export function PrinterPanel() {
  const mode = usePrinterStore((s) => s.connectionMode);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase text-gray-400 tracking-wider">
          Printer
        </h3>
        <ModeToggle />
      </div>
      {mode === "proxy" ? <ProxyPanel /> : <BluetoothPanel />}
    </div>
  );
}
