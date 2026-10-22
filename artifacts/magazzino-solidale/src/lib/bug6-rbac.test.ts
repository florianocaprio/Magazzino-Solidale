import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { AuthUser } from "@workspace/api-client-react";
import { authorizationSignature, isIdentityQuery } from "./auth-cache";
import {
  applyAreaSelection,
  applyAllAreaPermissions,
  areaCheckboxState,
  existingRoleSelection,
} from "./area-permissions";
import { hasLogisticsReportSource } from "./logistics-report-access";
import { canAccessMapsApplication } from "./maps-access";

const catalog = [
  {
    key: "uds",
    permessi: ["uds.view", "shared", "sensitive"],
    permessiOrdinari: ["uds.view", "shared"],
  },
  {
    key: "sociale",
    permessi: ["social.view", "shared"],
    permessiOrdinari: ["social.view", "shared"],
  },
];
describe("BUG6 — editor, identità e risposte in volo", () => {
  it("completa una selezione parziale senza assegnare dati sensibili", () => {
    const partial = { aree: ["uds"], permessi: ["uds.view"] };
    expect(
      areaCheckboxState("uds", partial.aree, partial.permessi, catalog),
    ).toBe("indeterminate");
    const completed = applyAreaSelection(partial, "uds", true, catalog);
    expect(completed).toEqual({
      aree: ["uds"],
      permessi: ["uds.view", "shared"],
    });
    expect(completed.permessi).not.toContain("sensitive");
  });
  it("rimuovere il gruppo o usare Nessuno conserva condivisi e capacità esplicite aggiuntive", () => {
    const value = {
      aree: ["uds", "sociale"],
      permessi: [
        "uds.view",
        "shared",
        "social.view",
        "sensitive",
        "unknown.persisted",
      ],
    };
    const removed = applyAreaSelection(value, "uds", false, catalog);
    expect(removed.permessi).toEqual([
      "shared",
      "social.view",
      "sensitive",
      "unknown.persisted",
    ]);
    expect(
      applyAllAreaPermissions(
        value.permessi,
        "uds",
        false,
        catalog,
        value.aree,
      ),
    ).toEqual(removed.permessi);
    expect(existingRoleSelection(value)).toEqual(value);
  });
  it("identità, grant e territorio diversi richiedono un nuovo contesto, ordine equivalente no", () => {
    const user = {
      id: 1,
      ruoloId: 2,
      areaOperativaId: 3,
      aree: ["uds"],
      permessi: ["a", "b"],
    } as AuthUser;
    expect(authorizationSignature(user)).toBe(
      authorizationSignature({ ...user, permessi: ["b", "a"] }),
    );
    for (const changed of [
      { ...user, id: 8 },
      { ...user, areaOperativaId: 9 },
      { ...user, permessi: ["a"] },
      { ...user, ruoloId: 5 },
    ])
      expect(authorizationSignature(changed)).not.toBe(
        authorizationSignature(user),
      );
  });
  it("cancellare e rimuovere il vecchio scope non permette a una risposta tardiva di ripopolare la cache", async () => {
    const client = new QueryClient();
    let finish!: (value: string) => void;
    const request = client
      .fetchQuery({
        queryKey: ["/api/private"],
        queryFn: ({ signal }) => {
          void signal.aborted; // consume the cancellation signal, as generated clients do
          return new Promise<string>((resolve) => {
            finish = resolve;
          });
        },
      })
      .catch(() => undefined);
    await client.cancelQueries({
      predicate: (query) => !isIdentityQuery(query.queryKey),
    });
    client.removeQueries({
      predicate: (query) => !isIdentityQuery(query.queryKey),
    });
    finish("OLD-IDENTITY-DATA");
    await request;
    expect(client.getQueryData(["/api/private"])).toBeUndefined();
    client.clear();
  });
  it("MAPS del Volontario richiede anche la sorgente consegne concessa", () => {
    const user = { isAdmin: false, isSuperAdmin: false };
    expect(
      canAccessMapsApplication(
        user,
        (area) => area === "logistica",
        (grant) => ["maps.operational", "consegne.view"].includes(grant),
      ),
    ).toBe(true);
    expect(
      canAccessMapsApplication(
        user,
        (area) => area === "logistica",
        (grant) => grant === "maps.operational",
      ),
    ).toBe(false);
  });
});

it("il report Logistica non appare con archivi spenti; il report Magazzino resta indipendente", () => {
  const grants = () => true;
  const flags = (key: string) => key !== "LOGISTICA";
  expect(
    hasLogisticsReportSource((key) => key === "logistica", grants, flags),
  ).toBe(false);
  expect(
    hasLogisticsReportSource((key) => key === "magazzino", grants, flags),
  ).toBe(true);
  expect(
    hasLogisticsReportSource(
      (key) => key === "logistica",
      (key) => key === "logistica.volontari.view",
      (key) => ["REPORT", "LOGISTICA", "VOLONTARI"].includes(key),
    ),
  ).toBe(true);
});
