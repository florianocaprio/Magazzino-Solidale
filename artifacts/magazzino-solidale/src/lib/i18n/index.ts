import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { LANGUAGES, LANGUAGE_CODES, STORAGE_KEY, applyDirection, type LanguageCode } from "./languages";
import { base } from "./namespaces/base";
import { dashboard } from "./namespaces/dashboard";
import { magazzini } from "./namespaces/magazzini";
import { prodotti } from "./namespaces/prodotti";
import { lotti } from "./namespaces/lotti";
import { movimenti } from "./namespaces/movimenti";
import { giacenze } from "./namespaces/giacenze";
import { trasferimenti } from "./namespaces/trasferimenti";
import { scarichi } from "./namespaces/scarichi";
import { centriAscolto } from "./namespaces/centriAscolto";
import { beneficiari } from "./namespaces/beneficiari";
import { beneficiarioDettaglio } from "./namespaces/beneficiarioDettaglio";
import { interventi } from "./namespaces/interventi";
import { consegne } from "./namespaces/consegne";
import { bolle } from "./namespaces/bolle";
import { volontari } from "./namespaces/volontari";
import { mezzi } from "./namespaces/mezzi";
import { fornitori } from "./namespaces/fornitori";
import { approvvigionamenti } from "./namespaces/approvvigionamenti";
import { report } from "./namespaces/report";
import { impostazioniStampa } from "./namespaces/impostazioniStampa";
import { utenti } from "./namespaces/utenti";
import { ruoli } from "./namespaces/ruoli";
import { login } from "./namespaces/login";
import { changePassword } from "./namespaces/changePassword";
import { notAuthorized } from "./namespaces/notAuthorized";
import { notFound } from "./namespaces/notFound";
import { tessera } from "./namespaces/tessera";

export { LANGUAGES, isRtl, applyDirection } from "./languages";
export type { LanguageCode } from "./languages";

const PAGE_NAMESPACES = {
  dashboard,
  magazzini,
  prodotti,
  lotti,
  movimenti,
  giacenze,
  trasferimenti,
  scarichi,
  centriAscolto,
  beneficiari,
  beneficiarioDettaglio,
  interventi,
  consegne,
  bolle,
  volontari,
  mezzi,
  fornitori,
  approvvigionamenti,
  report,
  impostazioniStampa,
  utenti,
  ruoli,
  login,
  changePassword,
  notAuthorized,
  notFound,
  tessera,
} as const;

function buildResources() {
  const resources: Record<string, { translation: Record<string, unknown> }> = {};
  for (const lng of LANGUAGE_CODES) {
    const translation: Record<string, unknown> = { ...(base as Record<LanguageCode, Record<string, unknown>>)[lng] };
    for (const [key, ns] of Object.entries(PAGE_NAMESPACES)) {
      translation[key] = (ns as Record<LanguageCode, unknown>)[lng];
    }
    resources[lng] = { translation };
  }
  return resources;
}

const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
const initialLng = saved && LANGUAGES.some((l) => l.code === saved) ? saved : "it";

i18n.use(initReactI18next).init({
  resources: buildResources(),
  lng: initialLng,
  fallbackLng: "it",
  interpolation: { escapeValue: false },
});

applyDirection(initialLng);

i18n.on("languageChanged", (lng) => {
  if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, lng);
  applyDirection(lng);
});

export default i18n;
