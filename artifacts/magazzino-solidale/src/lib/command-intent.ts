import { useRef } from "react";

export type IdempotentCommandPayload<T extends Record<string, unknown>> = T & {
  idempotencyKey: string;
};

type StoredIntent = {
  semanticFingerprint: string;
  payload: Record<string, unknown> & { idempotencyKey: string };
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneValue) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        cloneValue(item),
      ]),
    ) as T;
  }
  return value;
}

function defaultKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Un errore HTTP è un esito determinato del comando. Errori di rete, abort e
 * risposte non decodificabili possono invece avvenire dopo il commit: in quei
 * casi il retry deve riusare richiesta e chiave originali.
 */
export function shouldRetainCommandIntent(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name !== "ApiError";
}

export class CommandIntentRegistry {
  private readonly intents = new Map<string, StoredIntent>();

  constructor(private readonly createKey: () => string = defaultKey) {}

  prepare<T extends Record<string, unknown>>(
    slot: string,
    semanticInput: unknown,
    requestPayload: T,
  ): IdempotentCommandPayload<T> {
    const semanticFingerprint = JSON.stringify(canonicalize(semanticInput));
    const current = this.intents.get(slot);
    if (current?.semanticFingerprint === semanticFingerprint)
      return cloneValue(current.payload) as IdempotentCommandPayload<T>;

    const payload = {
      ...cloneValue(requestPayload),
      idempotencyKey: this.createKey(),
    } as IdempotentCommandPayload<T>;
    this.intents.set(slot, {
      semanticFingerprint,
      payload: cloneValue(payload),
    });
    return cloneValue(payload);
  }

  complete(slot: string): void {
    this.intents.delete(slot);
  }

  fail(slot: string, error: unknown): void {
    if (!shouldRetainCommandIntent(error)) this.intents.delete(slot);
  }

  discard(slot: string): void {
    this.intents.delete(slot);
  }

  has(slot: string): boolean {
    return this.intents.has(slot);
  }
}

export function useCommandIntentRegistry(): CommandIntentRegistry {
  const registry = useRef<CommandIntentRegistry | null>(null);
  if (registry.current == null) registry.current = new CommandIntentRegistry();
  return registry.current;
}
