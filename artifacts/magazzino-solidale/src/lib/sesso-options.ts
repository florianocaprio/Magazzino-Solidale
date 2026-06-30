export const SESSO_OPTIONS = [
  { value: "M", beneficiarioLabelKey: "maschio", udsLabelKey: "sessoM" },
  { value: "F", beneficiarioLabelKey: "femmina", udsLabelKey: "sessoF" },
  { value: "ALTRO", beneficiarioLabelKey: "altro", udsLabelKey: "sessoAltro" },
] as const;

export type SessoOptionValue = (typeof SESSO_OPTIONS)[number]["value"];
