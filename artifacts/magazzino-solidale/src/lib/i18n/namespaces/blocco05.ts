import { caricoPratiche } from "./caricoPratiche";
import type { i18n } from "i18next";
const it = {
  insertProduct: "Inserisci Prodotto",
  removeProduct: "Rimuovi Prodotto",
  addMore: "Inserire altri prodotti",
  suspend: "Sospendi Carico",
  closePanel: "Chiudi pannello",
  productAdded:
    "{{name}} inserito nella pratica. Chiudi il pannello per completare la riga.",
  searchProducts: "Cerca per nome, codice o barcode",
  rowNotFound:
    "Prodotto inserito. Ricarica il dettaglio per individuare la nuova riga.",
};
const en: typeof it = {
  insertProduct: "Insert product",
  removeProduct: "Remove product",
  addMore: "Add more products",
  suspend: "Suspend load",
  closePanel: "Close panel",
  productAdded:
    "{{name}} added to the practice. Close the panel to complete the row.",
  searchProducts: "Search by name, code or barcode",
  rowNotFound: "Product added. Reload the detail to locate the new row.",
};
const es: typeof it = {
  insertProduct: "Insertar producto",
  removeProduct: "Eliminar producto",
  addMore: "Añadir más productos",
  suspend: "Suspender carga",
  closePanel: "Cerrar panel",
  productAdded:
    "{{name}} añadido al expediente. Cierra el panel para completar la fila.",
  searchProducts: "Buscar por nombre, código o código de barras",
  rowNotFound:
    "Producto añadido. Recarga el detalle para localizar la nueva fila.",
};
const fr: typeof it = {
  insertProduct: "Insérer le produit",
  removeProduct: "Retirer le produit",
  addMore: "Ajouter d’autres produits",
  suspend: "Suspendre le chargement",
  closePanel: "Fermer le panneau",
  productAdded:
    "{{name}} ajouté au dossier. Fermez le panneau pour compléter la ligne.",
  searchProducts: "Rechercher par nom, code ou code-barres",
  rowNotFound:
    "Produit ajouté. Rechargez le détail pour retrouver la nouvelle ligne.",
};
const de: typeof it = {
  insertProduct: "Produkt einfügen",
  removeProduct: "Produkt entfernen",
  addMore: "Weitere Produkte hinzufügen",
  suspend: "Einlagerung unterbrechen",
  closePanel: "Seitenbereich schließen",
  productAdded:
    "{{name}} zum Vorgang hinzugefügt. Schließen Sie den Seitenbereich, um die Zeile auszufüllen.",
  searchProducts: "Nach Name, Code oder Barcode suchen",
  rowNotFound:
    "Produkt hinzugefügt. Laden Sie die Details neu, um die neue Zeile zu finden.",
};
const ar: typeof it = {
  insertProduct: "إدراج المنتج",
  removeProduct: "إزالة المنتج",
  addMore: "إضافة منتجات أخرى",
  suspend: "تعليق الإدخال",
  closePanel: "إغلاق اللوحة",
  productAdded: "تمت إضافة {{name}} إلى المعاملة. أغلق اللوحة لإكمال الصف.",
  searchProducts: "البحث بالاسم أو الرمز أو الباركود",
  rowNotFound: "تمت إضافة المنتج. أعد تحميل التفاصيل للعثور على الصف الجديد.",
};
export const blocco05 = { it, en, es, fr, de, ar };
export function registerBlocco05(instance: i18n) {
  for (const [language, resource] of Object.entries(blocco05))
    instance.addResourceBundle(
      language,
      "translation",
      {
        blocco05: resource,
        caricoPratiche: caricoPratiche[language as keyof typeof caricoPratiche],
      },
      true,
      true,
    );
}
