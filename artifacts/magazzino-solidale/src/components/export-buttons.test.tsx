import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportToXlsx: vi.fn(),
  exportToPdf: vi.fn(),
  loadBranding: vi.fn(),
  user: undefined as undefined | { id: number; username: string },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/lib/export", () => ({
  exportToXlsx: mocks.exportToXlsx,
  exportToPdf: mocks.exportToPdf,
}));

vi.mock("@/lib/branding-ambiente", () => ({
  loadDocumentBrandingForPdf: mocks.loadBranding,
}));

import { ExportButtons } from "./export-buttons";

type Row = { id: number; nome: string };

function trigger(): HTMLButtonElement {
  const result = Array.from(document.querySelectorAll("button")).find(
    (button) =>
      button.textContent?.includes("common.export") &&
      !button.textContent?.includes("common.exportExcel") &&
      !button.textContent?.includes("common.exportPdf"),
  );
  if (!result) throw new Error("Trigger Export non trovato");
  return result;
}

async function openMenu(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
      }),
    );
  });
}

function menuItem(label: string): HTMLElement {
  const result = Array.from(
    document.querySelectorAll<HTMLElement>("[role=menuitem]"),
  ).find((item) => item.textContent?.includes(label));
  if (!result) throw new Error(`Voce ${label} non trovata`);
  return result;
}

describe("ExportButtons", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.exportToXlsx.mockReset();
    mocks.user = undefined;
    mocks.exportToPdf.mockReset();
    mocks.loadBranding.mockReset().mockResolvedValue({
      branding: {},
      logoDataUrl: undefined,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("usa lo stato Radix aperto sul trigger comune", async () => {
    await act(async () =>
      root.render(
        <ExportButtons<Row>
          rows={[{ id: 1, nome: "Pasta" }]}
          columns={[{ header: "Nome", accessor: (row) => row.nome }]}
          filename="prodotti"
          title="Prodotti"
        />,
      ),
    );

    const button = trigger();
    expect(button.dataset.state).toBe("closed");
    await openMenu(button);
    expect(button.dataset.state).toBe("open");
    expect(button.classList.contains("data-[state=open]:ring-2")).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("true");

    await openMenu(button);
    expect(button.dataset.state).toBe("closed");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await openMenu(button);
    expect(button.dataset.state).toBe("open");
  });
  it("M63 rivalida dopo il branding PDF e non scarica dopo un diniego", async () => {
    let ready!: (value: { branding: object }) => void;
    mocks.loadBranding.mockImplementation(
      () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
    );
    const denied = Object.assign(new Error("Revoca"), { status: 403 });
    const beforeExport = vi.fn().mockRejectedValue(denied),
      onError = vi.fn();
    await act(async () =>
      root.render(
        <ExportButtons<Row>
          rows={[{ id: 1, nome: "Sintetico" }]}
          columns={[]}
          title="Interventi"
          filename="interventi"
          beforeExport={beforeExport}
          onError={onError}
        />,
      ),
    );
    await openMenu(trigger());
    await act(async () => menuItem("common.exportPdf").click());
    expect(beforeExport).not.toHaveBeenCalled();
    await act(async () => {
      ready({ branding: {} });
    });
    expect(beforeExport).toHaveBeenCalledTimes(1);
    expect(mocks.exportToPdf).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(denied);
    expect(trigger().disabled).toBe(false);
  });

  it.each(["context", "identity", "logout"])(
    "M67-37 blocks a late XLSX after %s changes",
    async (change) => {
      let ready!: (rows: Row[]) => void;
      const loadRows = vi.fn(
        () =>
          new Promise<Row[]>((resolve) => {
            ready = resolve;
          }),
      );
      const onError = vi.fn();
      mocks.user = { id: 1, username: "synthetic-a" };
      const render = (contextKey: string) => (
        <ExportButtons<Row>
          rows={[]}
          loadRows={loadRows}
          columns={[]}
          title="Movimenti"
          filename="movimenti"
          contextKey={contextKey}
          onError={onError}
        />
      );
      await act(async () => root.render(render("area-a")));
      await openMenu(trigger());
      await act(async () => menuItem("common.exportExcel").click());
      if (change === "identity")
        mocks.user = { id: 2, username: "synthetic-b" };
      if (change === "logout") mocks.user = undefined;
      await act(async () =>
        root.render(render(change === "context" ? "area-b" : "area-a")),
      );
      await act(async () => ready([{ id: 1, nome: "Private A" }]));
      expect(mocks.exportToXlsx).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(loadRows).toHaveBeenCalledTimes(1);
    },
  );

  it("M67-37 denies download when the current server authorization has been revoked", async () => {
    const denied = new Error("Revoked");
    const validateDownload = vi.fn().mockRejectedValue(denied),
      onError = vi.fn();
    await act(async () =>
      root.render(
        <ExportButtons<Row>
          rows={[{ id: 1, nome: "Synthetic" }]}
          columns={[]}
          title="Movimenti"
          filename="movimenti"
          validateDownload={validateDownload}
          onError={onError}
        />,
      ),
    );
    await openMenu(trigger());
    await act(async () => menuItem("common.exportExcel").click());
    expect(validateDownload).toHaveBeenCalledTimes(1);
    expect(mocks.exportToXlsx).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(denied);
  });

  it("mostra il pending e impedisce esportazioni duplicate", async () => {
    let resolveRows: ((rows: Row[]) => void) | undefined;
    const loadRows = vi.fn(
      () =>
        new Promise<Row[]>((resolve) => {
          resolveRows = resolve;
        }),
    );

    await act(async () =>
      root.render(
        <ExportButtons<Row>
          rows={[]}
          loadRows={loadRows}
          columns={[{ header: "Nome", accessor: (row) => row.nome }]}
          filename="prodotti"
          title="Prodotti"
        />,
      ),
    );

    const button = trigger();
    await openMenu(button);
    const xlsx = menuItem("common.exportExcel");

    await act(async () => {
      xlsx.click();
      xlsx.click();
      await Promise.resolve();
    });

    expect(loadRows).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toContain("common.exporting");

    await act(async () => {
      resolveRows?.([{ id: 1, nome: "Pasta" }]);
      await Promise.resolve();
    });

    expect(mocks.exportToXlsx).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBe("false");
    expect(button.textContent).toContain("common.export");
  });

  it("protegge anche il PDF dal doppio avvio e ne conserva il contenuto", async () => {
    let resolveRows: ((rows: Row[]) => void) | undefined;
    const loadRows = vi.fn(
      () =>
        new Promise<Row[]>((resolve) => {
          resolveRows = resolve;
        }),
    );
    const columns = [{ header: "Nome", accessor: (row: Row) => row.nome }];

    await act(async () =>
      root.render(
        <ExportButtons<Row>
          rows={[]}
          loadRows={loadRows}
          columns={columns}
          filename="prodotti"
          title="Prodotti"
          subtitle="Catalogo"
          orientation="landscape"
        />,
      ),
    );

    const button = trigger();
    await openMenu(button);
    const pdf = menuItem("common.exportPdf");

    await act(async () => {
      pdf.click();
      pdf.click();
      await Promise.resolve();
    });

    expect(loadRows).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");

    const rows = [{ id: 1, nome: "Pasta" }];
    await act(async () => {
      resolveRows?.(rows);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.loadBranding).toHaveBeenCalledTimes(1);
    expect(mocks.exportToPdf).toHaveBeenCalledTimes(1);
    expect(mocks.exportToPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "prodotti",
        title: "Prodotti",
        subtitle: "Catalogo",
        orientation: "landscape",
        rows,
        columns,
      }),
    );
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBe("false");
  });
});
