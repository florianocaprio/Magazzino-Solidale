import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
// Unit harness mounts video synchronously; browser/portal and real camera
// behaviour remain manual UAT, not simulated by this test.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
  stop: vi.fn(),
  hints: undefined as Map<unknown, unknown> | undefined,
  t: (key: string) => key,
}));
vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    constructor(hints: Map<unknown, unknown>) {
      mocks.hints = hints;
    }
    decodeFromConstraints = mocks.decode;
  },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
import { BarcodeScannerButton } from "./barcode-scanner-button";
let root: Root, host: HTMLDivElement;
let media: PropertyDescriptor | undefined;
const scanned = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  media = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
  mocks.decode.mockReset().mockResolvedValue({ stop: mocks.stop });
  mocks.stop.mockReset();
  scanned.mockReset();
  mocks.hints = undefined;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  if (media) Object.defineProperty(navigator, "mediaDevices", media);
  else Reflect.deleteProperty(navigator, "mediaDevices");
});
async function open() {
  await act(() => root.render(<BarcodeScannerButton onScan={scanned} />));
  await act(() =>
    host
      .querySelector<HTMLButtonElement>(
        'button[aria-label="barcodeScanner.button"]',
      )!
      .click(),
  );
}
it.each([
  ["NotAllowedError", "barcodeScanner.errPermission"],
  ["SecurityError", "barcodeScanner.errPermission"],
  ["NotFoundError", "barcodeScanner.errNoCamera"],
  ["OverconstrainedError", "barcodeScanner.errNoCamera"],
  ["UnexpectedError", "barcodeScanner.errGeneric"],
])(
  "camera %s shows contextual error without selecting a beneficiary",
  async (name, key) => {
    mocks.decode.mockRejectedValue({ name });
    await open();
    expect(document.body.textContent).toContain(key);
    expect(scanned).not.toHaveBeenCalled();
  },
);
it("insecure/unavailable media API shows the dedicated error without starting ZXing", async () => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: undefined,
  });
  await open();
  expect(document.body.textContent).toContain("barcodeScanner.errInsecure");
  expect(mocks.decode).not.toHaveBeenCalled();
  expect(scanned).not.toHaveBeenCalled();
});
it("existing ZXing supports QR/barcodes and forwards only a nonempty opaque token", async () => {
  await open();
  expect(mocks.hints?.get(DecodeHintType.POSSIBLE_FORMATS)).toEqual(
    expect.arrayContaining([BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128]),
  );
  const callback = mocks.decode.mock.calls[0][2];
  await act(() =>
    callback({ getText: () => "   " }, undefined, { stop: mocks.stop }),
  );
  expect(scanned).not.toHaveBeenCalled();
  await act(() =>
    callback({ getText: () => " MS-SYNTHETIC-F1 " }, undefined, {
      stop: mocks.stop,
    }),
  );
  expect(scanned).toHaveBeenCalledExactlyOnceWith("MS-SYNTHETIC-F1");
  expect(mocks.stop).toHaveBeenCalled();
});
