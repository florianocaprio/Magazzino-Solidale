// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useConsegnaScan } from "./use-consegna-scan";
import { BarcodeScannerButton } from "@/components/barcode-scanner-button";
const lookup = vi.hoisted(() => vi.fn());
const camera = vi.hoisted(() => ({ decode: vi.fn(), stop: vi.fn() }));
vi.mock("@/lib/use-moduli", () => ({ useConfigurazioneAmbienteFlags: () => ({ isModuloAttivo: () => true }) }));
vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromConstraints = camera.decode;
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@workspace/api-client-react", () => ({
  getConsegnaBeneficiarioDaCodice: lookup,
}));
let root: Root, host: HTMLDivElement, scan: ReturnType<typeof useConsegnaScan>;
const found = vi.fn(),
  error = vi.fn();
const person = {
  id: 101,
  codice: "LEGACY-101",
  nome: "Fixture",
  cognome: "Scanner",
  centroAscoltoId: null,
};
function Probe({ context = "A-user1", enabled = true }) {
  scan = useConsegnaScan({
    context,
    enabled,
    areaOperativaId: 1,
    onFound: found,
    onError: error,
  });
  return (
    <>
      <BarcodeScannerButton
        onScan={(code) => {
          void scan(code);
        }}
      />
      <input
        aria-label="keyboard scanner"
        onKeyDown={(event) => {
          if (event.key === "Enter") void scan(event.currentTarget.value);
        }}
      />
    </>
  );
}
async function mount(context = "A-user1", enabled = true) {
  await act(async () =>
    root.render(<Probe context={context} enabled={enabled} />),
  );
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await mount();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("actual camera component callback and keyboard input share the same application resolver", async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
  try {
    camera.decode.mockResolvedValue({ stop: camera.stop });
    lookup.mockResolvedValue(person);
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="barcodeScanner.button"]',
        )!
        .click(),
    );
    expect(camera.decode).toHaveBeenCalledTimes(1);
    const callback = camera.decode.mock.calls[0][2];
    await act(async () =>
      callback({ getText: () => "LEGACY-101" }, undefined, {
        stop: camera.stop,
      }),
    );
    expect(found).toHaveBeenCalledExactlyOnceWith(person);
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="keyboard scanner"]',
    )!;
    input.value = "LEGACY-101";
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(found).toHaveBeenCalledTimes(1);
  } finally {
    if (original) Object.defineProperty(navigator, "mediaDevices", original);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  }
});
it("camera and keyboard duplicate callbacks use one exact lookup without any creation", async () => {
  lookup.mockResolvedValue(person);
  await Promise.all([scan(" LEGACY-101 "), scan("legacy-101")]);
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(found).toHaveBeenCalledExactlyOnceWith(person);
  expect(lookup.mock.calls[0][0]).toEqual({
    codice: "LEGACY-101",
    areaOperativaId: 1,
    centroAscoltoId: undefined,
  });
  expect(error).not.toHaveBeenCalled();
});
for (const context of ["B-user1", "A-user2", "closed"])
  it(`rejects a late response after ${context}`, async () => {
    let resolve!: (value: typeof person) => void;
    lookup.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = scan("LEGACY-101");
    const signal = lookup.mock.calls[0][1].signal;
    await mount(context, context !== "closed");
    resolve(person);
    await pending;
    expect(signal.aborted).toBe(true);
    expect(found).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
it("new code supersedes old request; an unavailable code remains an error", async () => {
  let resolve!: (value: typeof person) => void;
  lookup
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockRejectedValueOnce({ status: 404 });
  const old = scan("OLD");
  await scan("UNKNOWN");
  resolve(person);
  await old;
  expect(found).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledExactlyOnceWith({ status: 404 });
});
it("disabled context and empty scan never access the directory", async () => {
  await scan(" ");
  await mount("disabled", false);
  await scan("LEGACY-101");
  expect(lookup).not.toHaveBeenCalled();
});
