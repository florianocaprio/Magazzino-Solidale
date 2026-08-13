import type { FasciaEtaCorrente, FasciaEtaOrigine } from "@workspace/api-zod";

type Translate = (key: string) => string;

export function fasciaEtaLabel(t: Translate, fascia: FasciaEtaCorrente): string {
  return t(`udsAnagrafica.fasciaEta.${fascia}`);
}

export function fasciaEtaOrigineLabel(t: Translate, origine: FasciaEtaOrigine): string {
  return t(`udsAnagrafica.fasciaEtaOrigine.${origine}`);
}
