import type { i18n } from "i18next";
const it = {
  currentAssignment: "Assegnazione attuale",
  backToRequests: "Ritorna alle Richieste",
  noZone: "Senza zona",
  territory: "Area, Centro e Zona UDS",
  historical: "Non attiva",
  changedFilter:
    "Appartenenza aggiornata. Se la persona esce dai filtri dell’elenco, non sarà più visibile con quei filtri.",
  scopeLocked:
    "Il vincolo del profilo è rispettato; questa assegnazione non può essere modificata qui.",
  card: "Tessera",
  cardDownload: "Scarica tessera PDF",
  cardInvalid: "Tessera non valida: {{stato}}",
  cardFailed:
    "Download non completato. Riprova: la tessera già emessa verrà recuperata.",
  noPermission: "Operazione non autorizzata",
  disabled: "Servizio disabilitato",
  unavailable: "Stato non disponibile",
  services: "Stati dei servizi",
  partial: "Persona creata; abilitazioni incomplete",
  samePerson:
    "Persona già creata: {{codice}}. Riprova le abilitazioni senza creare duplicati.",
  openPerson: "Apri beneficiario",
  servicesDone: "Persona creata e abilitazioni completate",
  expired: "Scaduta",
  udsPerson: "Scheda UDS",
  searchMinimum: "Digita almeno 2 caratteri per cercare.",
};
const en: typeof it = {
  currentAssignment: "Current assignment",
  backToRequests: "Return to Requests",
  noZone: "No zone",
  territory: "Area, reference centre and UDS zone",
  historical: "Inactive",
  changedFilter:
    "Assignment updated. The person may no longer match the current directory filters.",
  scopeLocked:
    "Your profile's territorial restriction is enforced; this assignment cannot be changed here.",
  card: "Card",
  cardDownload: "Download card PDF",
  cardInvalid: "Card not valid: {{stato}}",
  cardFailed: "Download failed. Retry to recover the card already issued.",
  noPermission: "Operation not authorised",
  disabled: "Service disabled",
  unavailable: "Status unavailable",
  services: "Service statuses",
  partial: "Person created; some service authorisations are incomplete",
  samePerson:
    "Person already created: {{codice}}. Retry service authorisation without creating a duplicate.",
  openPerson: "Open person",
  servicesDone: "Person created and service authorisations completed",
  expired: "Expired",
  udsPerson: "UDS record",
  searchMinimum: "Enter at least 2 characters to search.",
};
const es: typeof it = {
  currentAssignment: "Asignación actual",
  backToRequests: "Volver a solicitudes",
  noZone: "Sin zona",
  territory: "Área, Centro y Zona UDS",
  historical: "Inactiva",
  changedFilter:
    "Asignación actualizada. La persona puede dejar de coincidir con los filtros actuales.",
  scopeLocked:
    "Se respeta el ámbito del perfil; esta asignación no puede cambiarse aquí.",
  card: "Tarjeta",
  cardDownload: "Descargar tarjeta PDF",
  cardInvalid: "Tarjeta no válida: {{stato}}",
  cardFailed:
    "No se completó la descarga. Reintenta para recuperar la tarjeta ya emitida.",
  noPermission: "Operación no autorizada",
  disabled: "Servicio desactivado",
  unavailable: "Estado no disponible",
  services: "Estados de los servicios",
  partial: "Persona creada; autorizaciones incompletas",
  samePerson:
    "Persona ya creada: {{codice}}. Reintenta las autorizaciones sin crear duplicados.",
  openPerson: "Abrir persona",
  servicesDone: "Persona creada y autorizaciones completadas",
  expired: "Caducada",
  udsPerson: "Ficha UDS",
  searchMinimum: "Escribe al menos 2 caracteres para buscar.",
};
const fr: typeof it = {
  currentAssignment: "Affectation actuelle",
  backToRequests: "Retour aux demandes",
  noZone: "Sans zone",
  territory: "Zone, Centre et Zone UDS",
  historical: "Inactive",
  changedFilter:
    "Affectation mise à jour. La personne peut ne plus correspondre aux filtres actuels.",
  scopeLocked:
    "Le périmètre du profil est respecté ; cette affectation ne peut pas être modifiée ici.",
  card: "Carte",
  cardDownload: "Télécharger la carte PDF",
  cardInvalid: "Carte non valide : {{stato}}",
  cardFailed:
    "Téléchargement incomplet. Réessayez pour récupérer la carte déjà émise.",
  noPermission: "Opération non autorisée",
  disabled: "Service désactivé",
  unavailable: "État indisponible",
  services: "États des services",
  partial: "Personne créée ; autorisations incomplètes",
  samePerson:
    "Personne déjà créée : {{codice}}. Réessayez les autorisations sans créer de doublon.",
  openPerson: "Ouvrir la personne",
  servicesDone: "Personne créée et autorisations terminées",
  expired: "Expirée",
  udsPerson: "Fiche UDS",
  searchMinimum: "Saisissez au moins 2 caractères pour rechercher.",
};
const de: typeof it = {
  currentAssignment: "Aktuelle Zuordnung",
  backToRequests: "Zurück zu Anfragen",
  noZone: "Ohne Zone",
  territory: "Gebiet, Zentrum und UDS-Zone",
  historical: "Inaktiv",
  changedFilter:
    "Zuordnung aktualisiert. Die Person entspricht möglicherweise nicht mehr den aktuellen Filtern.",
  scopeLocked:
    "Die Einschränkung des Profils bleibt erhalten; diese Zuordnung kann hier nicht geändert werden.",
  card: "Karte",
  cardDownload: "Karte als PDF herunterladen",
  cardInvalid: "Karte ungültig: {{stato}}",
  cardFailed:
    "Download fehlgeschlagen. Beim erneuten Versuch wird die bereits ausgestellte Karte abgerufen.",
  noPermission: "Vorgang nicht erlaubt",
  disabled: "Dienst deaktiviert",
  unavailable: "Status nicht verfügbar",
  services: "Dienststatus",
  partial: "Person erstellt; Berechtigungen unvollständig",
  samePerson:
    "Person bereits erstellt: {{codice}}. Berechtigungen erneut versuchen, ohne ein Duplikat zu erstellen.",
  openPerson: "Person öffnen",
  servicesDone: "Person erstellt und Berechtigungen abgeschlossen",
  expired: "Abgelaufen",
  udsPerson: "UDS-Kartei",
  searchMinimum: "Mindestens 2 Zeichen für die Suche eingeben.",
};
const ar: typeof it = {
  currentAssignment: "التعيين الحالي",
  backToRequests: "العودة إلى الطلبات",
  noZone: "بلا منطقة",
  territory: "النطاق والمركز ومنطقة وحدة الشارع",
  historical: "غير نشطة",
  changedFilter:
    "تم تحديث التعيين. قد لا يعود الشخص مطابقًا لعوامل التصفية الحالية.",
  scopeLocked: "يتم احترام نطاق صلاحيات الحساب؛ لا يمكن تغيير هذا التعيين هنا.",
  card: "البطاقة",
  cardDownload: "تنزيل البطاقة PDF",
  cardInvalid: "البطاقة غير صالحة: {{stato}}",
  cardFailed: "لم يكتمل التنزيل. أعد المحاولة لاستعادة البطاقة الصادرة بالفعل.",
  noPermission: "العملية غير مصرح بها",
  disabled: "الخدمة معطلة",
  unavailable: "الحالة غير متاحة",
  services: "حالات الخدمات",
  partial: "تم إنشاء الشخص؛ بعض الصلاحيات غير مكتملة",
  samePerson:
    "الشخص مسجل بالفعل: {{codice}}. أعد محاولة الصلاحيات دون إنشاء سجل مكرر.",
  openPerson: "فتح الشخص",
  servicesDone: "تم إنشاء الشخص وإكمال الصلاحيات",
  expired: "منتهية الصلاحية",
  udsPerson: "ملف وحدة الشارع",
  searchMinimum: "أدخل حرفين على الأقل للبحث.",
};
// Etichette del documento caricate con il modulo, senza pesare sull’avvio.
const progress = {
  it: {
    in_preparazione: "In preparazione",
    pronta: "Pronta",
    in_viaggio: "In viaggio",
    rientro_atteso: "Rientro atteso",
    esito_registrato: "Esito logistico registrato",
    rientrato: "Rientrato",
    annullato: "Annullato",
    non_disponibile: "Stato non disponibile",
    stato_non_riconosciuto:
      "Stato non riconosciuto: operazione non disponibile",
  },
  en: {
    in_preparazione: "In preparation",
    pronta: "Ready",
    in_viaggio: "In transit",
    rientro_atteso: "Return expected",
    esito_registrato: "Logistics outcome recorded",
    rientrato: "Returned",
    annullato: "Cancelled",
    non_disponibile: "Status unavailable",
    stato_non_riconosciuto: "Unknown status: operation unavailable",
  },
  es: {
    in_preparazione: "En preparación",
    pronta: "Lista",
    in_viaggio: "En tránsito",
    rientro_atteso: "Retorno esperado",
    esito_registrato: "Resultado logístico registrado",
    rientrato: "Devuelto",
    annullato: "Anulado",
    non_disponibile: "Estado no disponible",
    stato_non_riconosciuto: "Estado desconocido: operación no disponible",
  },
  fr: {
    in_preparazione: "En préparation",
    pronta: "Prête",
    in_viaggio: "En transit",
    rientro_atteso: "Retour attendu",
    esito_registrato: "Résultat logistique enregistré",
    rientrato: "Retourné",
    annullato: "Annulé",
    non_disponibile: "État indisponible",
    stato_non_riconosciuto: "État inconnu : opération indisponible",
  },
  de: {
    in_preparazione: "In Vorbereitung",
    pronta: "Bereit",
    in_viaggio: "Unterwegs",
    rientro_atteso: "Rückkehr erwartet",
    esito_registrato: "Logistikergebnis erfasst",
    rientrato: "Zurückgekehrt",
    annullato: "Storniert",
    non_disponibile: "Status nicht verfügbar",
    stato_non_riconosciuto: "Unbekannter Status: Vorgang nicht verfügbar",
  },
  ar: {
    in_preparazione: "قيد التحضير",
    pronta: "جاهزة",
    in_viaggio: "قيد النقل",
    rientro_atteso: "العودة متوقعة",
    esito_registrato: "تم تسجيل النتيجة اللوجستية",
    rientrato: "تمت العودة",
    annullato: "ملغى",
    non_disponibile: "الحالة غير متاحة",
    stato_non_riconosciuto: "حالة غير معروفة: العملية غير متاحة",
  },
};
export function registerBlocco04(instance: Pick<i18n, "addResourceBundle">) {
  for (const [lang, labels] of Object.entries({
    it,
    en,
    es,
    fr,
    de,
    ar,
  }))
    instance.addResourceBundle(
      lang,
      "translation",
      {
        blocco04: labels,
        richiesteMagazzino: {
          progress: progress[lang as keyof typeof progress],
        },
      },
      true,
      true,
    );
}
