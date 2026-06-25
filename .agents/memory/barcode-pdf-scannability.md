---
name: Barcode PDF scannability geometry
description: How to size CODE128 barcodes in client-side jsPDF labels so a physical scanner reads them reliably.
---

When rendering CODE128 barcodes into a jsPDF document via JsBarcode (canvas → PNG → addImage), naive fit-to-box scaling silently shrinks the printed module width (X-dimension) and quiet zone for longer code values, making them unreadable.

Rule:
- Render the canvas with `width:3` px/module and a generous `margin` (~24px) so the quiet zone scales with the bars.
- When placing, cap the printed scale so the module width stays ~0.5mm for normal codes: `ratio = min(targetK, maxW/canvasW, boxH/canvasH)` where `targetK = 0.5/3` mm-per-px. The `min` keeps short codes uniform and only shrinks long codes to fit (best effort).
- A 2-column A4 card layout fits typical warehouse codes (≤ ~13 chars / EAN-13) comfortably; very long values (30–50 chars) physically cannot stay scanner-safe at that density — out of scope.

**Why:** The product-catalog barcode export must be printed and scanned for warehouse load/unload; the in-app scanner (movimenti/bolle) matches the scanned string against `codiceBarre || codice`, so the printed barcode encodes exactly that value.

**How to apply:** Reuse this for any printable barcode/label export. The product-catalog generator lives in `prodotti-barcode-pdf.ts`; the tessera card barcode is in `tessera-pdf.ts`.
