import { useCallback, type RefObject } from "react";
import type Konva from "konva";
import { usePrinterStore } from "../store/printer-store.ts";
import { useCanvasExport } from "./use-canvas-export.ts";
import { getPrinter } from "./use-web-bluetooth.ts";
import { proxyPrint } from "../transport/proxy.ts";

export function usePrinter(stageRef: RefObject<Konva.Stage | null>) {
  const { exportForPrint } = useCanvasExport(stageRef);
  const settings = usePrinterStore((s) => s.settings);

  const print = useCallback(async () => {
    const mode = usePrinterStore.getState().connectionMode;

    const raw = exportForPrint();
    if (!raw) {
      usePrinterStore.getState().setError("Failed to export canvas");
      return;
    }

    usePrinterStore.getState().setPrinting(true);
    usePrinterStore.getState().setError(null);

    try {
      if (mode === "proxy") {
        await proxyPrint(
          { data: raw.data, width: raw.width, height: raw.height },
          {
            density: settings.density,
            paperType: settings.paperType,
            ditherMode: settings.ditherMode,
            threshold: settings.threshold,
          },
        );
      } else {
        const printer = getPrinter();
        if (!printer) {
          usePrinterStore.getState().setError("No printer connected");
          return;
        }
        await printer.print(raw, {
          density: settings.density,
          paperType: settings.paperType,
          dither: settings.ditherMode,
          threshold: settings.threshold,
        });
      }
    } catch (err) {
      usePrinterStore.getState().setError(
        err instanceof Error ? err.message : "Print failed",
      );
    } finally {
      usePrinterStore.getState().setPrinting(false);
      usePrinterStore.getState().setPrintProgress(null);
    }
  }, [exportForPrint, settings]);

  return { print };
}
