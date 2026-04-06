import { useCallback, type RefObject } from "react";
import type Konva from "konva";
import type { RawImageData } from "@thermoprint/core";
import { useEditorStore } from "../store/editor-store.ts";

/**
 * Capture just the label region from the full-size stage at 1:1 pixel resolution.
 */
function captureLabel(stage: Konva.Stage, widthPx: number, heightPx: number): HTMLCanvasElement {
  const layer = stage.getLayers()[0];
  const origStageW = stage.width();
  const origStageH = stage.height();
  const origLayerX = layer.x();
  const origLayerY = layer.y();
  const displayScale = layer.scaleX();

  const displayW = widthPx * displayScale;
  const displayH = heightPx * displayScale;

  // Temporarily resize so toCanvas captures only the label
  stage.width(displayW);
  stage.height(displayH);
  layer.x(0);
  layer.y(0);

  const canvas = stage.toCanvas({ pixelRatio: 1 / displayScale });

  // Restore
  stage.width(origStageW);
  stage.height(origStageH);
  layer.x(origLayerX);
  layer.y(origLayerY);
  stage.batchDraw();

  return canvas;
}

export function useCanvasExport(stageRef: RefObject<Konva.Stage | null>) {
  const labelConfig = useEditorStore((s) => s.labelConfig);

  /** Export label for printing. Returns unrotated canvas; protocol handles orientation. */
  const exportForPrint = useCallback((): RawImageData | null => {
    const stage = stageRef.current;
    if (!stage) return null;

    const raw = captureLabel(stage, labelConfig.widthPx, labelConfig.heightPx);
    const ctx = raw.getContext("2d")!;
    const imgData = ctx.getImageData(0, 0, raw.width, raw.height);
    
    return { data: imgData.data, width: raw.width, height: raw.height };
  }, [stageRef, labelConfig]);

  return { exportForPrint };
}
