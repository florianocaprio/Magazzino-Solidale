import { caricoPratiche } from "./caricoPratiche";
import type { i18n } from "i18next";
const it = {
  openPractice: "Apertura Pratica",
  saveChanges: "Salva modifiche",
  practiceData: "Dati pratica",
  productSaved: "Prodotto salvato",
  cancelPractice: "Annulla Pratica",
  editRegistered: "Modifica prodotto",
  reversed: "Stornati: {{quantity}} {{unit}}",
  replaceHelp:
    "La quantità di questa riga verrà stornata dal magazzino e lo storico conservato. La riga tornerà tra i prodotti da caricare: modifica i dati, salva e conferma nuovamente il carico. La merce già distribuita o impegnata non può essere stornata.",
  removeHelp:
    "La quantità di questa riga verrà stornata dal magazzino. Lo storico resterà consultabile. La merce già distribuita o impegnata non può essere stornata.",
  confirmCorrection: "Conferma rettifica",
  correctionSaved: "Rettifica salvata",

  insertProduct: "Inserisci Prodotto",
  removeProduct: "Rimuovi Prodotto",
  addMore: "Inserimento prodotti",
  suspend: "Sospendi Carico",
  closePanel: "Chiudi pannello",
  productAdded:
    "{{name}} inserito nella pratica. Chiudi il pannello per completare la riga.",
  searchProducts: "Cerca per nome, codice o barcode",
  rowNotFound:
    "Prodotto inserito. Ricarica il dettaglio per individuare la nuova riga.",
};
const en: typeof it = {
  openPractice: "Open practice",
  saveChanges: "Save changes",
  practiceData: "Practice details",
  productSaved: "Product saved",
  cancelPractice: "Cancel practice",
  editRegistered: "Edit product",
  reversed: "Reversed: {{quantity}} {{unit}}",
  replaceHelp:
    "This row will be reversed from stock, preserving history. An editable copy will appear among pending products: edit, save and register it again. Distributed or reserved goods cannot be reversed.",
  removeHelp:
    "This row will be reversed from stock, preserving history. Distributed or reserved goods cannot be reversed.",
  confirmCorrection: "Confirm correction",
  correctionSaved: "Correction saved",

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
  openPractice: "Abrir expediente",
  saveChanges: "Guardar cambios",
  practiceData: "Datos del expediente",
  productSaved: "Producto guardado",
  cancelPractice: "Anular expediente",
  editRegistered: "Modificar producto",
  reversed: "Revertido: {{quantity}} {{unit}}",
  replaceHelp:
    "Se revertirá esta fila del inventario conservando el historial. Aparecerá una copia editable entre los productos pendientes: modifica, guarda y registra de nuevo. No se pueden revertir mercancías distribuidas o reservadas.",
  removeHelp:
    "Se revertirá esta fila del inventario conservando el historial. No se pueden revertir mercancías distribuidas o reservadas.",
  confirmCorrection: "Confirmar corrección",
  correctionSaved: "Corrección guardada",

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
  openPractice: "Ouvrir le dossier",
  saveChanges: "Enregistrer les modifications",
  practiceData: "Données du dossier",
  productSaved: "Produit enregistré",
  cancelPractice: "Annuler le dossier",
  editRegistered: "Modifier le produit",
  reversed: "Annulé : {{quantity}} {{unit}}",
  replaceHelp:
    "Cette ligne sera annulée du stock en conservant son historique. Une copie modifiable apparaîtra parmi les produits en attente : modifiez, enregistrez et comptabilisez à nouveau. Les marchandises distribuées ou réservées ne peuvent pas être annulées.",
  removeHelp:
    "Cette ligne sera annulée du stock en conservant son historique. Les marchandises distribuées ou réservées ne peuvent pas être annulées.",
  confirmCorrection: "Confirmer la correction",
  correctionSaved: "Correction enregistrée",

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
  openPractice: "Vorgang eröffnen",
  saveChanges: "Änderungen speichern",
  practiceData: "Vorgangsdaten",
  productSaved: "Produkt gespeichert",
  cancelPractice: "Vorgang stornieren",
  editRegistered: "Produkt bearbeiten",
  reversed: "Storniert: {{quantity}} {{unit}}",
  replaceHelp:
    "Diese Zeile wird unter Erhalt der Historie aus dem Bestand storniert. Eine bearbeitbare Kopie erscheint unter den ausstehenden Produkten: bearbeiten, speichern und erneut buchen. Verteilte oder reservierte Ware kann nicht storniert werden.",
  removeHelp:
    "Diese Zeile wird unter Erhalt der Historie aus dem Bestand storniert. Verteilte oder reservierte Ware kann nicht storniert werden.",
  confirmCorrection: "Korrektur bestätigen",
  correctionSaved: "Korrektur gespeichert",

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
  openPractice: "فتح المعاملة",
  saveChanges: "حفظ التغييرات",
  practiceData: "بيانات المعاملة",
  productSaved: "تم حفظ المنتج",
  cancelPractice: "إلغاء المعاملة",
  editRegistered: "تعديل المنتج",
  reversed: "الكمية المعكوسة: {{quantity}} {{unit}}",
  replaceHelp:
    "سيتم عكس هذا الصف من المخزون مع الاحتفاظ بالسجل. ستظهر نسخة قابلة للتعديل ضمن المنتجات المعلقة: عدلها واحفظها ثم سجلها مجدداً. لا يمكن عكس البضائع الموزعة أو المحجوزة.",
  removeHelp:
    "سيتم عكس هذا الصف من المخزون مع الاحتفاظ بالسجل. لا يمكن عكس البضائع الموزعة أو المحجوزة.",
  confirmCorrection: "تأكيد التصحيح",
  correctionSaved: "تم حفظ التصحيح",

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
