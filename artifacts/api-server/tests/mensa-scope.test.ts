import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

const harness = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@workspace/db", () => ({
  db: { transaction: harness.transaction },
  utentiTable: { id: "utente_id" },
  ruoliTable: { id: "ruolo_id" },
  utentiMenseTable: {},
  menseTable: {},
  magazziniTable: {},
  areeOperativeTable: {},
  centriAscoltoTable: {},
}));
import { currentMensaScope } from "../src/lib/mensaScope";

it("M61 scope: abort durante la lettura autorizzativa non lascia una transazione orfana", async () => {
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let query = 0;
  const chain = {
    from: () => chain,
    where: () => chain,
    for: async () => {
      if (query++ === 0) {
        entered();
        await blocked;
        return [{ id: 1, attivo: true, ruoloId: 2 }];
      }
      return [{ id: 2, isAdmin: true }];
    },
  };
  harness.transaction.mockImplementation(async (fn) =>
    fn({ select: () => chain }),
  );
  const response = new EventEmitter() as EventEmitter & {
    destroyed: boolean;
    headersSent: boolean;
  };
  response.destroyed = false;
  response.headersSent = false;
  const next = vi.fn();
  let settled = false;
  const execution = Promise.resolve(
    currentMensaScope(
      { user: { id: 1 } } as Request,
      response as unknown as Response,
      next as NextFunction,
    ),
  ).then(() => {
    settled = true;
  });
  await reading;
  response.destroyed = true;
  response.emit("close");
  release();
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  const completedAfterAbort = settled;
  // Anche nel rosso libera il test senza lasciare il callback in attesa.
  response.emit("finish");
  await execution;
  expect(completedAfterAbort).toBe(true);
  expect(next).not.toHaveBeenCalled();
});
