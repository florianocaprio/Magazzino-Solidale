export * from "./generated/api";
export * from "./generated/types";
// Orval gives the path validators and query types the same names for these DELETEs.
export { DeleteBeneficiarioParams, DeleteUtenteParams } from "./generated/api";
export type { DeleteBeneficiarioParams as DeleteBeneficiarioQuery } from "./generated/types";
export type { DeleteUtenteParams as DeleteUtenteQuery } from "./generated/types";
export * from "./fasciaEta";
export { z } from "zod";
