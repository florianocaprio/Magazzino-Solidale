// Same read capability as the canonical request API. Reporting alone does not
// grant access; command buttons keep their own request/receive/manage checks.
export const MENSA_REQUEST_READ_PERMISSIONS = [
  "mensa.transfers.request",
  "mensa.transfers.receive",
  "mensa.transfers.manage",
] as const;
