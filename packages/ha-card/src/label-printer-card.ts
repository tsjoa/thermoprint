/**
 * Home Assistant Lovelace Card: Label Printer Card
 * Interactive thermal label designer with live WYSIWYG preview, QR generator,
 * media presets, and direct ESPHome BLE Gateway integration.
 */

import QRCode from "qrcode";

interface CardConfig {
  type: string;
  title?: string;
  gateway_entity?: string;
  default_width?: number;
  default_height?: number;
  default_density?: number;
  default_paper?: "gap" | "continuous";
}

interface HomeAssistant {
  states: Record<string, { state: string; attributes: Record<string, unknown> }>;
  callService: (domain: string, service: string, serviceData?: Record<string, unknown>) => Promise<unknown>;
}

interface CustomCardDesc {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
  documentationURL?: string;
}

interface WindowWithCustomCards extends Window {
  customCards?: CustomCardDesc[];
}

const PRESET_SIZES = [
  { name: "40 × 12 mm (Standard P15/P12)", widthMm: 40.0, heightMm: 12.0, printableWidthMm: 38.7 },
  { name: "30 × 12 mm", widthMm: 30.0, heightMm: 12.0, printableWidthMm: 28.7 },
  { name: "40 × 20 mm", widthMm: 40.0, heightMm: 20.0, printableWidthMm: 38.7 },
  { name: "50 × 15 mm", widthMm: 50.0, heightMm: 15.0, printableWidthMm: 48.7 },
  { name: "Custom Size", widthMm: 40.0, heightMm: 12.0, printableWidthMm: 38.7, custom: true },
];

const PRESET_TEMPLATES = [
  { label: "Storage Box", text: "STORAGE\nSHELF B4\nBOX 12", qr: true, qrText: "BOX-12-SHELF-B4" },
  { label: "Inventory / SKU", text: "PART-8891\nLOCATION: A-04\nQTY: 25", qr: true, qrText: "SKU-8891-A04" },
  { label: "Cable Wrap", text: "ETHERNET #04\nSERVER RACK 2\nPATCH P08", qr: false, qrText: "" },
  { label: "Pantry / Date", text: "OATS (ROLLED)\nPACKED: 13/09\nUSE BY: 6 MOS", qr: false, qrText: "" },
];

export class LabelPrinterCard extends HTMLElement {
  private _hass?: HomeAssistant;
  private _config: CardConfig = { type: "custom:label-printer-card" };

  // Card Internal State
  private text: string = "STORAGE\nSHELF B4\nBOX 12";
  private widthMm: number = 38.7;
  private heightMm: number = 12.0;
  private paperType: "gap" | "continuous" = "gap";
  private density: number = 3;
  private feedMm: number = 5.0;
  private border: boolean = true;
  private includeQr: boolean = false;
  private qrText: string = "";
  private qrPosition: "left" | "right" = "left";
  private selectedPrinter: string = "5E:55:09:26:72:D3";
  private statusType: "idle" | "loading" | "success" | "error" = "idle";
  private statusTimer?: number;
  // DOM Elements
  private root: ShadowRoot;
  private canvas?: HTMLCanvasElement;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
  }

  public setConfig(config: CardConfig) {
    this._config = { ...config };
    if (config.default_width) this.widthMm = config.default_width;
    if (config.default_height) this.heightMm = config.default_height;
    if (config.default_density) this.density = config.default_density;
    if (config.default_paper) this.paperType = config.default_paper;
    this.render();
  }

  public set hass(hass: HomeAssistant) {
    this._hass = hass;
    this.updateGatewayStatus();
  }

  public getCardSize(): number {
    return 7;
  }

  private updateGatewayStatus() {
    if (!this._hass) return;
    const ipEntity = this._hass.states["sensor.ble_thermal_printer_gateway_printer_gateway_ip"];
    const statusBadge = this.root.getElementById("gateway-badge");
    if (statusBadge && ipEntity) {
      statusBadge.innerHTML = `<span class="dot online"></span> Gateway ${ipEntity.state || "192.168.20.18"}`;
      statusBadge.className = "gateway-status online";
    }
  }

  private render() {
    this.root.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: var(--paper-font-body1_-_font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
          --card-padding: 16px;
        }
        ha-card {
          padding: var(--card-padding);
          background: var(--ha-card-background, var(--card-background-color, #ffffff));
          color: var(--primary-text-color, #212121);
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0,0,0,0.08));
          overflow: hidden;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .header-title {
          font-size: 1.15rem;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .header-title svg {
          width: 22px;
          height: 22px;
          fill: var(--primary-color, #03a9f4);
        }
        .gateway-status {
          font-size: 0.75rem;
          font-weight: 500;
          padding: 3px 8px;
          border-radius: 12px;
          background: var(--secondary-background-color, #f0f0f0);
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--secondary-text-color, #666);
        }
        .gateway-status.online {
          background: rgba(76, 175, 80, 0.12);
          color: #2e7d32;
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #aaa;
        }
        .dot.online {
          background: #4caf50;
          box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.25);
        }

        /* Preview Stage */
        .preview-container {
          background: var(--secondary-background-color, #f7f9fa);
          border: 1px solid var(--divider-color, #e0e0e0);
          border-radius: 8px;
          padding: 16px 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          margin-bottom: 14px;
        }
        .preview-pad {
          position: relative;
          background: #ffffff;
          border-radius: 4px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0,0,0,0.05);
          overflow: hidden;
          transition: width 0.2s ease, height 0.2s ease;
        }
        .preview-pad.gap-mode::before,
        .preview-pad.gap-mode::after {
          content: "";
          position: absolute;
          width: 8px;
          height: 8px;
          background: var(--secondary-background-color, #f7f9fa);
          border-radius: 50%;
          top: 50%;
          transform: translateY(-50%);
          z-index: 2;
        }
        .preview-pad.gap-mode::before { left: -4px; }
        .preview-pad.gap-mode::after { right: -4px; }
        canvas {
          display: block;
          image-rendering: pixelated;
        }
        .preview-footer {
          margin-top: 8px;
          font-size: 0.72rem;
          color: var(--secondary-text-color, #757575);
          display: flex;
          align-items: center;
          gap: 12px;
        }

        /* Form Controls */
        .section-label {
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--secondary-text-color, #616161);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin: 12px 0 6px 0;
        }
        .textarea-wrap {
          position: relative;
          margin-bottom: 8px;
        }
        textarea {
          width: 100%;
          box-sizing: border-box;
          padding: 8px 10px;
          font-size: 0.92rem;
          border-radius: 6px;
          border: 1px solid var(--divider-color, #ccc);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #000);
          resize: vertical;
          min-height: 64px;
          font-family: inherit;
        }
        textarea:focus {
          outline: none;
          border-color: var(--primary-color, #03a9f4);
          box-shadow: 0 0 0 2px rgba(3, 169, 244, 0.2);
        }

        /* Chips / Presets */
        .chips-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 12px;
        }
        .chip {
          font-size: 0.75rem;
          padding: 4px 10px;
          border-radius: 14px;
          background: var(--secondary-background-color, #f0f2f5);
          color: var(--primary-text-color, #333);
          border: 1px solid var(--divider-color, #e0e0e0);
          cursor: pointer;
          user-select: none;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .chip:hover {
          background: var(--primary-color, #03a9f4);
          color: #fff;
          border-color: var(--primary-color, #03a9f4);
        }

        /* Grid Controls */
        .controls-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-bottom: 12px;
        }
        @media (max-width: 480px) {
          .controls-grid { grid-template-columns: 1fr; }
        }
        .control-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .control-group label {
          font-size: 0.78rem;
          font-weight: 500;
          color: var(--secondary-text-color, #666);
        }
        select, input[type="text"], input[type="number"] {
          box-sizing: border-box;
          width: 100%;
          padding: 6px 8px;
          font-size: 0.85rem;
          border-radius: 6px;
          border: 1px solid var(--divider-color, #ccc);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #000);
        }
        select:focus, input:focus {
          outline: none;
          border-color: var(--primary-color, #03a9f4);
        }

        /* Checkbox Rows */
        .toggle-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.85rem;
          cursor: pointer;
          user-select: none;
          margin-top: 4px;
        }
        .toggle-row input[type="checkbox"] {
          width: 16px;
          height: 16px;
          cursor: pointer;
        }

        /* QR Sub-Panel */
        .qr-panel {
          background: var(--secondary-background-color, #fafafa);
          border: 1px solid var(--divider-color, #eee);
          border-radius: 6px;
          padding: 8px 10px;
          margin-top: 6px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        /* Density Segmented */
        .segmented-group {
          display: flex;
          border-radius: 6px;
          overflow: hidden;
          border: 1px solid var(--divider-color, #ccc);
        }
        .segmented-btn {
          flex: 1;
          padding: 6px 0;
          font-size: 0.78rem;
          text-align: center;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #333);
          border: none;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }
        .segmented-btn + .segmented-btn {
          border-left: 1px solid var(--divider-color, #ccc);
        }
        .segmented-btn.active {
          background: var(--primary-color, #03a9f4);
          color: #ffffff;
          font-weight: 600;
        }

        /* Actions */
        .actions-row {
          display: flex;
          gap: 10px;
          margin-top: 16px;
        }
        .btn {
          flex: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 10px 14px;
          font-size: 0.9rem;
          font-weight: 600;
          border-radius: 8px;
          border: none;
          cursor: pointer;
          user-select: none;
          transition: opacity 0.15s, transform 0.1s;
        }
        .btn:active {
          transform: scale(0.98);
        }
        .btn-primary {
          flex: 2;
          background: var(--primary-color, #03a9f4);
          color: #ffffff;
        }
        .btn-secondary {
          background: var(--secondary-background-color, #eceff1);
          color: var(--primary-text-color, #37474f);
        }
        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .btn svg {
          width: 18px;
          height: 18px;
          fill: currentColor;
        }

        /* Notification Toast */
        .status-banner {
          margin-top: 10px;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 0.82rem;
          display: none;
          align-items: center;
          gap: 8px;
        }
        .status-banner.visible { display: flex; }
        .status-banner.loading {
          background: rgba(3, 169, 244, 0.12);
          color: #0288d1;
        }
        .status-banner.success {
          background: rgba(76, 175, 80, 0.15);
          color: #2e7d32;
        }
        .status-banner.error {
          background: rgba(244, 67, 54, 0.15);
          color: #d32f2f;
        }

        /* Spinner */
        .spinner {
          width: 14px;
          height: 14px;
          border: 2px solid currentColor;
          border-right-color: transparent;
          border-radius: 50%;
          animation: spin 0.75s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>

      <ha-card>
        <!-- Header -->
        <div class="header">
          <div class="header-title">
            <svg viewBox="0 0 24 24"><path d="M19,8H5C3.34,8 2,9.34 2,11V17H6V21H18V17H22V11C22,9.34 20.66,8 19,8M16,19H8V15H16V19M19,12C18.45,12 18,11.55 18,11C18,10.45 18.45,10 19,10C19.55,10 20,10.45 20,11C20,11.55 19.55,12 19,12M18,3H6V7H18V3Z"/></svg>
            <span>${this._config.title || "Label Printer"}</span>
          </div>
          <div id="gateway-badge" class="gateway-status">
            <span class="dot online"></span> Gateway 192.168.20.18
          </div>
        </div>

        <!-- Real-time Preview Area -->
        <div class="preview-container">
          <div id="preview-pad" class="preview-pad gap-mode">
            <canvas id="label-canvas"></canvas>
          </div>
          <div class="preview-footer">
            <span id="preview-dims">40.0 × 12.0 mm (310 × 96 px)</span>
            <span>•</span>
            <span id="preview-mode">Gap Indexed</span>
          </div>
        </div>

        <!-- Label Content Input -->
        <div class="section-label">Label Text</div>
        <div class="textarea-wrap">
          <textarea id="text-input" placeholder="Type label text (supports 1-3 lines)...">${this.text}</textarea>
        </div>

        <!-- Quick Template Chips -->
        <div class="chips-row">
          ${PRESET_TEMPLATES.map((t, idx) => `
            <div class="chip" data-template-idx="${idx}">${t.label}</div>
          `).join("")}
          <div class="chip" id="chip-clear" style="margin-left: auto;">✕ Clear</div>
        </div>

        <!-- QR Code Expansion -->
        <div class="toggle-row">
          <input type="checkbox" id="toggle-qr" ${this.includeQr ? "checked" : ""}>
          <label for="toggle-qr">Include Scannable QR Code</label>
        </div>

        <div id="qr-panel" class="qr-panel" style="display: ${this.includeQr ? "flex" : "none"};">
          <div class="control-group">
            <label>QR Code Content (URL, Serial, SKU):</label>
            <input type="text" id="qr-input" value="${this.qrText}" placeholder="Leave empty to use label text">
          </div>
          <div class="control-group">
            <label>QR Position:</label>
            <div class="segmented-group">
              <button class="segmented-btn ${this.qrPosition === "left" ? "active" : ""}" id="qr-pos-left">Left Side</button>
              <button class="segmented-btn ${this.qrPosition === "right" ? "active" : ""}" id="qr-pos-right">Right Side</button>
            </div>
          </div>
        </div>

        <!-- Media & Printer Grid -->
        <div class="section-label">Print & Media Settings</div>
        <div class="controls-grid">
          <div class="control-group">
            <label>Target Printer:</label>
            <select id="printer-select">
              <option value="5E:55:09:26:72:D3" ${this.selectedPrinter === "5E:55:09:26:72:D3" ? "selected" : ""}>Pristar P12 (5E:55:09:26:72:D3) • BLE</option>
              <option value="03:0D:7A:D6:5E:B1" ${this.selectedPrinter === "03:0D:7A:D6:5E:B1" ? "selected" : ""}>Pristar P15 (03:0D:7A:D6:5E:B1) • BLE</option>
              <option value="CUSTOM">Custom BLE MAC...</option>
            </select>
          </div>

          <div class="control-group">
            <label>Label Size Preset:</label>
            <select id="size-select">
              ${PRESET_SIZES.map((s, idx) => `
                <option value="${idx}" ${s.widthMm === 40 && s.heightMm === 12 ? "selected" : ""}>${s.name}</option>
              `).join("")}
            </select>
          </div>

          <div class="control-group">
            <label>Paper Roll Type:</label>
            <select id="paper-select">
              <option value="gap" ${this.paperType === "gap" ? "selected" : ""}>Die-Cut Gap (Optical Notch)</option>
              <option value="continuous" ${this.paperType === "continuous" ? "selected" : ""}>Continuous / Gapless Roll</option>
            </select>
          </div>

          <div class="control-group">
            <label>Print Density (Burn Time):</label>
            <div class="segmented-group">
              <button class="segmented-btn ${this.density === 1 ? "active" : ""}" data-density="1">Light</button>
              <button class="segmented-btn ${this.density === 3 ? "active" : ""}" data-density="3">Normal</button>
              <button class="segmented-btn ${this.density === 5 ? "active" : ""}" data-density="5">Dark</button>
            </div>
          </div>
        </div>

        <div class="toggle-row">
          <input type="checkbox" id="toggle-border" ${this.border ? "checked" : ""}>
          <label for="toggle-border">Draw Outer Framing Border</label>
        </div>

        <!-- Status Toast Banner -->
        <div id="status-banner" class="status-banner">
          <div id="status-spinner" class="spinner" style="display:none;"></div>
          <span id="status-text"></span>
        </div>

        <!-- Action Buttons -->
        <div class="actions-row">
          <button class="btn btn-secondary" id="btn-feed" title="Advance roll to the next optical gap notch">
            <svg viewBox="0 0 24 24"><path d="M12,4L12,14L16,10L17.4,11.4L12,16.8L6.6,11.4L8,10L12,14V4M4,20H20V22H4V20Z"/></svg>
            <span>Feed Gap</span>
          </button>
          <button class="btn btn-secondary" id="btn-test" title="Print calibration test label">
            <span>Test Print</span>
          </button>
          <button class="btn btn-primary" id="btn-print" title="Send print job via ESP32 Gateway">
            <svg viewBox="0 0 24 24"><path d="M18 3H6V7H18V3M19 8H5C3.34 8 2 9.34 2 11V17H6V21H18V17H22V11C22 9.34 20.66 8 19 8M16 19H8V15H16V19M19 12C18.45 12 18 11.55 18 11C18 10.45 18.45 10 19 10C19.55 10 20 10.45 20 11C20 11.55 19.55 12 19 12Z"/></svg>
            <span id="print-label-text">Print Label</span>
          </button>
        </div>
      </ha-card>
    `;

    this.canvas = this.root.getElementById("label-canvas") as HTMLCanvasElement;
    this.bindEvents();
    this.drawPreview();
    this.updateGatewayStatus();
  }

  private bindEvents() {
    const textInput = this.root.getElementById("text-input") as HTMLTextAreaElement;
    textInput?.addEventListener("input", () => {
      this.text = textInput.value;
      this.drawPreview();
    });

    this.root.getElementById("chip-clear")?.addEventListener("click", () => {
      this.text = "";
      if (textInput) textInput.value = "";
      this.drawPreview();
    });

    this.root.querySelectorAll(".chip[data-template-idx]").forEach((chip) => {
      chip.addEventListener("click", (e) => {
        const target = e.currentTarget as HTMLElement;
        const idx = parseInt(target.getAttribute("data-template-idx") || "0", 10);
        const tpl = PRESET_TEMPLATES[idx];
        if (tpl) {
          this.text = tpl.text;
          if (textInput) textInput.value = tpl.text;
          this.includeQr = tpl.qr;
          this.qrText = tpl.qrText;
          const toggleQr = this.root.getElementById("toggle-qr") as HTMLInputElement;
          if (toggleQr) toggleQr.checked = tpl.qr;
          const qrInput = this.root.getElementById("qr-input") as HTMLInputElement;
          if (qrInput) qrInput.value = tpl.qrText;
          const qrPanel = this.root.getElementById("qr-panel");
          if (qrPanel) qrPanel.style.display = tpl.qr ? "flex" : "none";
          this.drawPreview();
        }
      });
    });

    const toggleQr = this.root.getElementById("toggle-qr") as HTMLInputElement;
    toggleQr?.addEventListener("change", () => {
      this.includeQr = toggleQr.checked;
      const qrPanel = this.root.getElementById("qr-panel");
      if (qrPanel) qrPanel.style.display = this.includeQr ? "flex" : "none";
      this.drawPreview();
    });

    const qrInput = this.root.getElementById("qr-input") as HTMLInputElement;
    qrInput?.addEventListener("input", () => {
      this.qrText = qrInput.value;
      this.drawPreview();
    });

    const btnLeft = this.root.getElementById("qr-pos-left");
    const btnRight = this.root.getElementById("qr-pos-right");
    btnLeft?.addEventListener("click", () => {
      this.qrPosition = "left";
      btnLeft.classList.add("active");
      btnRight?.classList.remove("active");
      this.drawPreview();
    });
    btnRight?.addEventListener("click", () => {
      this.qrPosition = "right";
      btnRight.classList.add("active");
      btnLeft?.classList.remove("active");
      this.drawPreview();
    });

    const toggleBorder = this.root.getElementById("toggle-border") as HTMLInputElement;
    toggleBorder?.addEventListener("change", () => {
      this.border = toggleBorder.checked;
      this.drawPreview();
    });

    const printerSelect = this.root.getElementById("printer-select") as HTMLSelectElement;
    printerSelect?.addEventListener("change", async () => {
      let val = printerSelect.value;
      if (val === "CUSTOM") {
        const customMac = prompt("Enter Bluetooth MAC address (e.g. 5E:55:09:26:72:D3):");
        if (customMac && customMac.trim()) {
          val = customMac.trim().toUpperCase();
          const opt = document.createElement("option");
          opt.value = val;
          opt.textContent = `Custom (${val}) • BLE`;
          opt.selected = true;
          printerSelect.insertBefore(opt, printerSelect.lastElementChild);
        } else {
          printerSelect.value = this.selectedPrinter;
          return;
        }
      }
      this.selectedPrinter = val;
      if (this._hass) {
        try {
          await this._hass.callService("esphome", "ble_printer_gateway_set_target_printer", {
            mac_address: this.selectedPrinter,
          });
          this.setStatus("success", `Target printer set to ${this.selectedPrinter}`);
        } catch (err: unknown) {
          console.warn("Could not set gateway target printer:", err);
        }
      }
    });

    const sizeSelect = this.root.getElementById("size-select") as HTMLSelectElement;
    sizeSelect?.addEventListener("change", () => {
      const preset = PRESET_SIZES[parseInt(sizeSelect.value, 10)];
      if (preset) {
        this.widthMm = preset.printableWidthMm || preset.widthMm;
        this.heightMm = preset.heightMm;
        this.drawPreview();
      }
    });
    const paperSelect = this.root.getElementById("paper-select") as HTMLSelectElement;
    paperSelect?.addEventListener("change", () => {
      this.paperType = paperSelect.value as "gap" | "continuous";
      const pad = this.root.getElementById("preview-pad");
      const modeSpan = this.root.getElementById("preview-mode");
      if (pad) {
        if (this.paperType === "gap") {
          pad.classList.add("gap-mode");
          if (modeSpan) modeSpan.textContent = "Die-Cut Gap";
        } else {
          pad.classList.remove("gap-mode");
          if (modeSpan) modeSpan.textContent = "Continuous Roll";
        }
      }
    });

    this.root.querySelectorAll("button[data-density]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        this.root.querySelectorAll("button[data-density]").forEach((b) => b.classList.remove("active"));
        const target = e.currentTarget as HTMLElement;
        target.classList.add("active");
        this.density = parseInt(target.getAttribute("data-density") || "3", 10);
      });
    });

    this.root.getElementById("btn-print")?.addEventListener("click", () => { void this.handlePrint(); });
    this.root.getElementById("btn-feed")?.addEventListener("click", () => { void this.handleFeedGap(); });
    this.root.getElementById("btn-test")?.addEventListener("click", () => { void this.handleTestPrint(); });
  }

  private async drawPreview() {
    if (!this.canvas) return;

    const canvasWidth = Math.round(this.widthMm * 8.0);
    const canvasHeight = Math.round(this.heightMm * 8.0);

    this.canvas.width = canvasWidth;
    this.canvas.height = canvasHeight;

    const containerMaxW = 320;
    const aspect = canvasWidth / canvasHeight;
    const displayW = Math.min(containerMaxW, Math.max(180, canvasWidth * 0.9));
    const displayH = displayW / aspect;

    this.canvas.style.width = `${displayW}px`;
    this.canvas.style.height = `${displayH}px`;

    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    if (this.border) {
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1;
      ctx.strokeRect(2.5, 2.5, canvasWidth - 5, canvasHeight - 5);
    }

    let textAvailX = this.border ? 6 : 4;
    let textAvailW = canvasWidth - (this.border ? 12 : 8);

    if (this.includeQr) {
      const qrContent = this.qrText.trim() || this.text.trim() || "PRINTER";
      try {
        const qr = QRCode.create(qrContent, { errorCorrectionLevel: "M" });
        const modCount = qr.modules.size;
        const qrBoxSize = canvasHeight - 16;
        const modSize = Math.floor(qrBoxSize / modCount);
        const actualQrW = modSize * modCount;

        const qrX = this.qrPosition === "left" ? (this.border ? 8 : 4) : canvasWidth - actualQrW - (this.border ? 8 : 4);
        const qrY = Math.round((canvasHeight - actualQrW) / 2);

        ctx.fillStyle = "#000000";
        for (let r = 0; r < modCount; r++) {
          for (let c = 0; c < modCount; c++) {
            if (qr.modules.get(r, c)) {
              ctx.fillRect(qrX + c * modSize, qrY + r * modSize, modSize, modSize);
            }
          }
        }

        const margin = 10;
        if (this.qrPosition === "left") {
          textAvailX = qrX + actualQrW + margin;
          textAvailW = canvasWidth - textAvailX - (this.border ? 6 : 4);
        } else {
          textAvailW = qrX - margin - textAvailX;
        }
      } catch (err: unknown) {
        console.warn("QR preview generation error:", err);
      }
    }

    const rawLines = this.text.split("\n").filter((l) => l.length > 0);
    const lines = rawLines.slice(0, 3);

    if (lines.length > 0) {
      ctx.fillStyle = "#000000";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const numLines = lines.length;

      let bestSize = 10;
      for (let s = 44; s >= 10; s -= 2) {
        ctx.font = `bold ${s}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        const lineH = s * 1.15;
        const totalH = lineH * numLines;
        if (totalH > canvasHeight - 12) continue;

        let maxW = 0;
        for (const line of lines) {
          const w = ctx.measureText(line).width;
          if (w > maxW) maxW = w;
        }
        if (maxW <= textAvailW) {
          bestSize = s;
          break;
        }
      }

      ctx.font = `bold ${bestSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      const lineH = bestSize * 1.15;
      const totalBlockH = lineH * numLines;
      const startY = (canvasHeight - totalBlockH) / 2 + lineH / 2;
      const centerX = textAvailX + textAvailW / 2;

      lines.forEach((line, i) => {
        ctx.fillText(line, centerX, startY + i * lineH);
      });
    }

    const dimsLabel = this.root.getElementById("preview-dims");
    if (dimsLabel) {
      dimsLabel.textContent = `${this.widthMm.toFixed(1)} × ${this.heightMm.toFixed(1)} mm (${canvasWidth} × ${canvasHeight} px)`;
    }
  }

  private setStatus(type: "idle" | "loading" | "success" | "error", message: string) {
    this.statusType = type;
    this.statusMessage = message;

    const banner = this.root.getElementById("status-banner");
    const textSpan = this.root.getElementById("status-text");
    const spinner = this.root.getElementById("status-spinner");

    if (this.statusTimer) clearTimeout(this.statusTimer);

    if (banner && textSpan && spinner) {
      if (type === "idle") {
        banner.className = "status-banner";
        spinner.style.display = "none";
      } else {
        banner.className = `status-banner visible ${type}`;
        textSpan.textContent = message;
        spinner.style.display = type === "loading" ? "inline-block" : "none";

        if (type === "success" || type === "error") {
          this.statusTimer = setTimeout(() => {
            this.setStatus("idle", "");
          }, 4000);
        }
      }
    }

    const btnPrint = this.root.getElementById("btn-print") as HTMLButtonElement;
    if (btnPrint) {
      btnPrint.disabled = type === "loading";
    }
  }

  private async handlePrint() {
    if (!this._hass) {
      this.setStatus("error", "Home Assistant connection not ready.");
      return;
    }

    if (!this.text.trim()) {
      this.setStatus("error", "Label text is empty. Enter text to print.");
      return;
    }

    this.setStatus("loading", "Connecting to ESP32 Gateway and printing...");

    try {
      await this._hass.callService("esphome", "ble_printer_gateway_print_text", {
        label_text: this.text,
        width_mm: this.widthMm,
        feed_mm: this.feedMm,
        density: this.density,
        printer_mac: this.selectedPrinter,
      });
    } catch (err: unknown) {
      console.error("Print service error:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      this.setStatus("error", `Print failed: ${errMsg}`);
    }
  }

  private async handleFeedGap() {
    if (!this._hass) return;
    this.setStatus("loading", "Advancing paper roll to next gap...");
    try {
      await this._hass.callService("esphome", "ble_printer_gateway_feed_gap", {});
      this.setStatus("success", "✓ Paper advanced to optical gap.");
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.setStatus("error", `Feed failed: ${errMsg}`);
    }
  }

  private async handleTestPrint() {
    if (!this._hass) return;
    this.setStatus("loading", "Printing gateway test label...");
    try {
      await this._hass.callService("esphome", "ble_printer_gateway_print_test_label", {});
      this.setStatus("success", "✓ Test label printed.");
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.setStatus("error", `Test print failed: ${errMsg}`);
    }
  }
}

if (!customElements.get("label-printer-card")) {
  customElements.define("label-printer-card", LabelPrinterCard);
}

const customWindow = window as unknown as WindowWithCustomCards;
customWindow.customCards = customWindow.customCards || [];
customWindow.customCards.push({
  type: "label-printer-card",
  name: "Label Printer Card",
  description: "Interactive thermal label printer with real-time WYSIWYG preview, QR code support, and ESP32 BLE gateway integration.",
  preview: true,
  documentationURL: "https://github.com/tsjok/thermoprint",
});
