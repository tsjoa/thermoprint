/**
 * Proxy transport: sends print jobs to the local `thermoprint serve` HTTP server
 * instead of using Web Bluetooth directly.
 */

const DEFAULT_URL = "http://10.0.15.92:7654";

export interface ProxyPrintOptions {
  density?: number;
  paperType?: "gap" | "continuous";
  ditherMode?: string;
  threshold?: number;
}

export async function proxyStatus(
  baseUrl = DEFAULT_URL,
): Promise<{ status: string; address: string; printing: boolean }> {
  const res = await fetch(`${baseUrl}/status`);
  if (!res.ok) throw new Error(`Proxy server error: ${res.status}`);
  return res.json();
}

export async function proxyPrint(
  imageData: { data: Uint8Array | number[]; width: number; height: number },
  settings?: ProxyPrintOptions,
  baseUrl = DEFAULT_URL,
): Promise<void> {
  const payload = {
    width: imageData.width,
    height: imageData.height,
    data: Array.from(imageData.data instanceof Uint8Array ? imageData.data : imageData.data),
    settings,
  };

  const res = await fetch(`${baseUrl}/print`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  if (!res.ok) {
    throw new Error(result.error ?? `Print failed: ${res.status}`);
  }
}
