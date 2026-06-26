---
name: zxing camera barcode scanner
description: Constraints for the in-app camera barcode scanner (zxing) used across the warehouse UI.
---

- Camera scanning is centralized in ONE reusable component (`BarcodeScannerButton`); reuse it for any new barcode input rather than re-adding zxing.
- `@zxing/library` must be pinned to match `@zxing/browser`'s declared peer range (currently 0.22.x). Installing a newer `@zxing/library` (e.g. 0.23) trips a peer-mismatch.
  - **Why:** the two packages share internal types; a version skew breaks typecheck/runtime in non-obvious ways.
- `getUserMedia` requires a secure context (HTTPS). The Replit preview and published apps are HTTPS, so it works there; guard for the insecure-context case anyway (older/embedded webviews).
- When adding a scanner button next to an EXISTING manual-scan handler, wrap the existing button's `onClick` in an arrow (`() => handler()`). React passes the MouseEvent as the first arg, so a handler refactored to take an optional `codeOverride` string would otherwise receive the event object.
