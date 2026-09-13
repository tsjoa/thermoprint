# Home Assistant Lovelace Card: Label Printer Card

A custom Lovelace card for printing labels from Home Assistant to **Pristar / Marklife P15, P12**, and L11 binary protocol thermal label printers via an **ESP32-C3 BLE Gateway**.

![Label Printer Card Preview](https://raw.githubusercontent.com/tsjok/thermoprint/main/packages/ha-card/preview.png)

## ✨ Features

- **Real-Time WYSIWYG Canvas Preview**: Exact 203 DPI (8 dots/mm) rendering showing label aspect ratio, text auto-scaling, centering, and margins.
- **Embedded QR Code Generator**: Generate and embed scannable QR codes (URL, SKU, Serial) on the left or right side with zero external network dependencies.
- **Media & Paper Presets**:
  - `40 × 12 mm` (Standard P15 / P12 roll)
  - `30 × 12 mm`
  - `40 × 20 mm`
  - `50 × 15 mm`
  - `Custom Width (mm)`
- **Die-Cut vs. Continuous Paper**:
  - **Die-Cut Gap**: Uses optical notch indexing (`1D 0C`) to stop flush on label boundaries.
  - **Continuous Roll**: Uses safe line feeds (`1B 4A`) to prevent runaway feeding.
- **Print Density / Contrast**: 3-step control (`Light`, `Normal`, `Dark`).
- **Quick Templates**: Storage box, inventory SKU, cable wrap, pantry date/time.
- **Direct Actions**: **Print Label**, **Feed Gap**, and **Test Print**.
- **Dark Mode & Themes**: Automatically matches Home Assistant theme CSS variables.

---

## 🚀 Installation

### 1. Copy Card Resource
Copy `dist/label-printer-card.js` to your Home Assistant `/config/www/` directory:
```bash
scp packages/ha-card/dist/label-printer-card.js root@<homeassistant_ip>:/config/www/
```

### 2. Register Dashboard Resource
In Home Assistant: **Settings** $\rightarrow$ **Dashboards** $\rightarrow$ **Resources** (top-right menu) $\rightarrow$ **Add Resource**:
* **URL**: `/local/label-printer-card.js`
* **Resource Type**: `JavaScript Module`

---

## 📋 Dashboard Card Configuration

Add the card to any dashboard view or view page:

```yaml
type: custom:label-printer-card
title: Thermal Label Studio
default_width: 38.7
default_height: 12.0
default_density: 3
default_paper: gap
```

---

## 🛠️ Card Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `title` | string | `Label Printer` | Card title displayed in header |
| `default_width` | number | `38.7` | Default printable width in mm |
| `default_height` | number | `12.0` | Default printable height in mm |
| `default_density`| number | `3` | Default burn density (1=light, 3=normal, 5=dark) |
| `default_paper` | string | `gap` | Default paper mode (`gap` or `continuous`) |
