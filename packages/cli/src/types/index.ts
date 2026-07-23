export interface Config {
  defaultPrinter?: string;
  defaultAddress?: string;
  density?: number;
  paperType?: "gap" | "continuous";
  timeout?: number;
  width?: number;
}

export const DEFAULT_CONFIG: Config = {
  defaultAddress: "03:0D:7A:D6:5E:B1",
  density: 3,
  paperType: "gap",
  timeout: 5000,
  width: 384,
};
