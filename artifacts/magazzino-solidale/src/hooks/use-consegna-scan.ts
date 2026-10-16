import { useEffect, useRef } from "react";
import {
  getConsegnaBeneficiarioDaCodice,
  type GetConsegnaBeneficiarioDaCodice200,
} from "@workspace/api-client-react";

/** Both keyboard and camera callbacks enter the same exact, cancellable lookup. */
export function useConsegnaScan(options: {
  context: string;
  enabled: boolean;
  areaOperativaId?: number;
  centroAscoltoId?: number;
  onFound: (person: GetConsegnaBeneficiarioDaCodice200) => void;
  onError: (error: unknown) => void;
}) {
  const current = useRef(options);
  current.current = options;
  const pending = useRef<{
    code: string;
    context: string;
    controller: AbortController;
  } | null>(null);
  useEffect(
    () => () => {
      pending.current?.controller.abort();
      pending.current = null;
    },
    [options.context],
  );
  return async (raw: string) => {
    const code = raw.trim();
    const start = current.current;
    if (!code || !start.enabled) return;
    if (
      pending.current?.context === start.context &&
      pending.current.code.toLowerCase() === code.toLowerCase()
    )
      return;
    pending.current?.controller.abort();
    const operation = {
      code,
      context: start.context,
      controller: new AbortController(),
    };
    pending.current = operation;
    try {
      const person = await getConsegnaBeneficiarioDaCodice(
        {
          codice: code,
          areaOperativaId: start.areaOperativaId,
          centroAscoltoId: start.centroAscoltoId,
        },
        { signal: operation.controller.signal },
      );
      if (
        pending.current !== operation ||
        operation.controller.signal.aborted ||
        current.current.context !== start.context ||
        !current.current.enabled
      )
        return;
      current.current.onFound(person);
    } catch (error) {
      if (
        !operation.controller.signal.aborted &&
        pending.current === operation &&
        current.current.context === start.context
      ) {
        pending.current = null;
        current.current.onError(error);
      }
    }
  };
}
