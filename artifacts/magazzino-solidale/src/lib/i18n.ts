import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const LANGUAGES = [
  { code: "it", label: "Italiano" },
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "ar", label: "العربية" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

const RTL_LANGUAGES: string[] = ["ar"];
const STORAGE_KEY = "ms-lang";

const resources = {
  it: {
    translation: {
      common: { logout: "Esci", noRole: "Nessun ruolo", language: "Lingua" },
      nav: {
        groups: {
          generale: "Generale",
          magazzino: "Magazzino",
          sociale: "Sociale",
          logistica: "Logistica",
          analisi: "Analisi",
          amministrazione: "Amministrazione",
        },
        items: {
          dashboard: "Dashboard",
          magazzini: "Magazzini",
          prodotti: "Catalogo Prodotti",
          lotti: "Lotti",
          movimenti: "Movimenti",
          giacenze: "Giacenze",
          trasferimenti: "Trasferimenti",
          scarichi: "Scarichi Manuali",
          centriAscolto: "Centri di Ascolto",
          beneficiari: "Beneficiari",
          interventi: "Interventi",
          consegne: "Consegne",
          bolle: "Bolle",
          volontari: "Volontari",
          mezzi: "Mezzi",
          fornitori: "Fornitori",
          approvvigionamenti: "Approvvigionamenti",
          report: "Report",
          impostazioniStampa: "Impostazioni Stampa Bolla",
          utenti: "Utenti & Accessi",
          ruoli: "Ruoli",
        },
      },
    },
  },
  es: {
    translation: {
      common: { logout: "Salir", noRole: "Sin rol", language: "Idioma" },
      nav: {
        groups: {
          generale: "General",
          magazzino: "Almacén",
          sociale: "Social",
          logistica: "Logística",
          analisi: "Análisis",
          amministrazione: "Administración",
        },
        items: {
          dashboard: "Panel",
          magazzini: "Almacenes",
          prodotti: "Catálogo de Productos",
          lotti: "Lotes",
          movimenti: "Movimientos",
          giacenze: "Existencias",
          trasferimenti: "Transferencias",
          scarichi: "Descargas Manuales",
          centriAscolto: "Centros de Escucha",
          beneficiari: "Beneficiarios",
          interventi: "Intervenciones",
          consegne: "Entregas",
          bolle: "Albaranes",
          volontari: "Voluntarios",
          mezzi: "Vehículos",
          fornitori: "Proveedores",
          approvvigionamenti: "Aprovisionamientos",
          report: "Informes",
          impostazioniStampa: "Ajustes de Impresión Albarán",
          utenti: "Usuarios y Accesos",
          ruoli: "Roles",
        },
      },
    },
  },
  en: {
    translation: {
      common: { logout: "Log out", noRole: "No role", language: "Language" },
      nav: {
        groups: {
          generale: "General",
          magazzino: "Warehouse",
          sociale: "Social",
          logistica: "Logistics",
          analisi: "Analytics",
          amministrazione: "Administration",
        },
        items: {
          dashboard: "Dashboard",
          magazzini: "Warehouses",
          prodotti: "Product Catalogue",
          lotti: "Lots",
          movimenti: "Movements",
          giacenze: "Stock",
          trasferimenti: "Transfers",
          scarichi: "Manual Discharges",
          centriAscolto: "Listening Centres",
          beneficiari: "Beneficiaries",
          interventi: "Interventions",
          consegne: "Deliveries",
          bolle: "Delivery Notes",
          volontari: "Volunteers",
          mezzi: "Vehicles",
          fornitori: "Suppliers",
          approvvigionamenti: "Procurement",
          report: "Reports",
          impostazioniStampa: "Delivery Note Print Settings",
          utenti: "Users & Access",
          ruoli: "Roles",
        },
      },
    },
  },
  fr: {
    translation: {
      common: { logout: "Déconnexion", noRole: "Aucun rôle", language: "Langue" },
      nav: {
        groups: {
          generale: "Général",
          magazzino: "Entrepôt",
          sociale: "Social",
          logistica: "Logistique",
          analisi: "Analyses",
          amministrazione: "Administration",
        },
        items: {
          dashboard: "Tableau de bord",
          magazzini: "Entrepôts",
          prodotti: "Catalogue de produits",
          lotti: "Lots",
          movimenti: "Mouvements",
          giacenze: "Stocks",
          trasferimenti: "Transferts",
          scarichi: "Sorties manuelles",
          centriAscolto: "Centres d'écoute",
          beneficiari: "Bénéficiaires",
          interventi: "Interventions",
          consegne: "Livraisons",
          bolle: "Bons de livraison",
          volontari: "Bénévoles",
          mezzi: "Véhicules",
          fornitori: "Fournisseurs",
          approvvigionamenti: "Approvisionnements",
          report: "Rapports",
          impostazioniStampa: "Paramètres d'impression des bons",
          utenti: "Utilisateurs et accès",
          ruoli: "Rôles",
        },
      },
    },
  },
  de: {
    translation: {
      common: { logout: "Abmelden", noRole: "Keine Rolle", language: "Sprache" },
      nav: {
        groups: {
          generale: "Allgemein",
          magazzino: "Lager",
          sociale: "Soziales",
          logistica: "Logistik",
          analisi: "Analysen",
          amministrazione: "Verwaltung",
        },
        items: {
          dashboard: "Übersicht",
          magazzini: "Lager",
          prodotti: "Produktkatalog",
          lotti: "Chargen",
          movimenti: "Bewegungen",
          giacenze: "Bestände",
          trasferimenti: "Transfers",
          scarichi: "Manuelle Abgänge",
          centriAscolto: "Anlaufstellen",
          beneficiari: "Begünstigte",
          interventi: "Maßnahmen",
          consegne: "Lieferungen",
          bolle: "Lieferscheine",
          volontari: "Freiwillige",
          mezzi: "Fahrzeuge",
          fornitori: "Lieferanten",
          approvvigionamenti: "Beschaffung",
          report: "Berichte",
          impostazioniStampa: "Druckeinstellungen Lieferschein",
          utenti: "Benutzer & Zugriff",
          ruoli: "Rollen",
        },
      },
    },
  },
  ar: {
    translation: {
      common: { logout: "تسجيل الخروج", noRole: "لا يوجد دور", language: "اللغة" },
      nav: {
        groups: {
          generale: "عام",
          magazzino: "المستودع",
          sociale: "الشؤون الاجتماعية",
          logistica: "اللوجستيات",
          analisi: "التحليلات",
          amministrazione: "الإدارة",
        },
        items: {
          dashboard: "لوحة التحكم",
          magazzini: "المستودعات",
          prodotti: "كتالوج المنتجات",
          lotti: "الدفعات",
          movimenti: "الحركات",
          giacenze: "المخزون",
          trasferimenti: "التحويلات",
          scarichi: "التفريغات اليدوية",
          centriAscolto: "مراكز الاستماع",
          beneficiari: "المستفيدون",
          interventi: "التدخلات",
          consegne: "التسليمات",
          bolle: "إشعارات التسليم",
          volontari: "المتطوعون",
          mezzi: "المركبات",
          fornitori: "الموردون",
          approvvigionamenti: "التموين",
          report: "التقارير",
          impostazioniStampa: "إعدادات طباعة إشعار التسليم",
          utenti: "المستخدمون والوصول",
          ruoli: "الأدوار",
        },
      },
    },
  },
} as const;

export function isRtl(lng: string): boolean {
  return RTL_LANGUAGES.includes(lng);
}

export function applyDirection(lng: string): void {
  document.documentElement.setAttribute("dir", isRtl(lng) ? "rtl" : "ltr");
  document.documentElement.setAttribute("lang", lng);
}

const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
const initialLng =
  saved && LANGUAGES.some((l) => l.code === saved) ? saved : "it";

i18n.use(initReactI18next).init({
  resources,
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
