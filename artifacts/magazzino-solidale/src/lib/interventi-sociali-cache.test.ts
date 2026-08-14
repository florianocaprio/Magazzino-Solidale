import { describe, expect, it, vi } from "vitest";
import {
  getGetInterventiRiepilogoVisteQueryKey,
  getListInterventiOperatoriQueryKey,
  getListInterventiQueryKey,
} from "@workspace/api-client-react";
import { invalidateInterventiSociali } from "./interventi-sociali-cache";

describe("cache degli interventi Sociali", () => {
  it("aggiorna lista, calendario, contatori e operatori dopo la creazione", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await invalidateInterventiSociali({ invalidateQueries });
    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: getListInterventiQueryKey(),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: getGetInterventiRiepilogoVisteQueryKey(),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: getListInterventiOperatoriQueryKey(),
    });
  });
});
