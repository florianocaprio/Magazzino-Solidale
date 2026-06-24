export const LANGUAGES = [
  { code: "it", label: "Italiano" },
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "ar", label: "العربية" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export const LANGUAGE_CODES: LanguageCode[] = LANGUAGES.map((l) => l.code);

export const STORAGE_KEY = "ms-lang";

const RTL_LANGUAGES: string[] = ["ar"];

export function isRtl(lng: string): boolean {
  return RTL_LANGUAGES.includes(lng);
}

export function applyDirection(lng: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("dir", isRtl(lng) ? "rtl" : "ltr");
  document.documentElement.setAttribute("lang", lng);
}
