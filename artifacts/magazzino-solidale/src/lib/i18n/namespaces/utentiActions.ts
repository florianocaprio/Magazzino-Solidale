import type { i18n } from "i18next";

const utentiActions = {
  it: {
    showPassword: "Mostra password",
    hidePassword: "Nascondi password",
    areaUnassigned: "Area non assegnata",
    actions: "Azioni",
    actionsFor: "Azioni per {{username}}",
    temporaryAction: "Assegna password temporanea",
    temporaryHelp:
      "Le sessioni e i link precedenti saranno revocati. L’utente dovrà cambiare questa password prima di utilizzare il servizio.",
    temporaryPolicy: "Almeno 8 caratteri, una lettera e un numero.",
    confirmPassword: "Conferma password temporanea",
    passwordMismatch: "Le password non coincidono.",
    temporarySuccess:
      "Password temporanea assegnata. Cambio obbligatorio al prossimo accesso.",
    reactivate: "Riattiva",
    remove: "Elimina",
    removeTitle: "Elimina utente?",
    removeHelp:
      "sarà eliminato definitivamente solo se mai utilizzato e senza dipendenze. Negli altri casi verrà disattivato conservando lo storico.",
    toastRemoved:
      "Rimozione completata; l’eventuale storico è stato conservato.",
  },
  es: {
    showPassword: "Mostrar contraseña",
    hidePassword: "Ocultar contraseña",
    areaUnassigned: "Área no asignada",
    actions: "Acciones",
    actionsFor: "Acciones para {{username}}",
    temporaryAction: "Asignar contraseña temporal",
    temporaryHelp:
      "Se revocarán las sesiones y los enlaces anteriores. El usuario deberá cambiar esta contraseña antes de usar el servicio.",
    temporaryPolicy: "Al menos 8 caracteres, una letra y un número.",
    confirmPassword: "Confirmar contraseña temporal",
    passwordMismatch: "Las contraseñas no coinciden.",
    temporarySuccess:
      "Contraseña temporal asignada. Cambio obligatorio en el próximo acceso.",
    reactivate: "Reactivar",
    remove: "Eliminar",
    removeTitle: "¿Eliminar usuario?",
    removeHelp:
      "se eliminará definitivamente solo si nunca se ha utilizado y no tiene dependencias. En los demás casos se desactivará conservando el historial.",
    toastRemoved:
      "Eliminación completada; se ha conservado el historial existente.",
  },
  en: {
    showPassword: "Show password",
    hidePassword: "Hide password",
    areaUnassigned: "Area not assigned",
    actions: "Actions",
    actionsFor: "Actions for {{username}}",
    temporaryAction: "Assign temporary password",
    temporaryHelp:
      "Previous sessions and reset links will be revoked. The user must change this password before using the service.",
    temporaryPolicy: "At least 8 characters, a letter and a number.",
    confirmPassword: "Confirm temporary password",
    passwordMismatch: "Passwords do not match.",
    temporarySuccess:
      "Temporary password assigned. A password change is required at next login.",
    reactivate: "Reactivate",
    remove: "Delete",
    removeTitle: "Delete user?",
    removeHelp:
      "will be permanently deleted only if never used and without dependencies. Otherwise it will be deactivated with history preserved.",
    toastRemoved: "Removal completed; any history has been preserved.",
  },
  fr: {
    showPassword: "Afficher le mot de passe",
    hidePassword: "Masquer le mot de passe",
    areaUnassigned: "Zone opérationnelle non attribuée",
    actions: "Actions",
    actionsFor: "Actions pour {{username}}",
    temporaryAction: "Attribuer un mot de passe temporaire",
    temporaryHelp:
      "Les sessions et liens précédents seront révoqués. L’utilisateur devra changer ce mot de passe avant d’utiliser le service.",
    temporaryPolicy: "Au moins 8 caractères, une lettre et un chiffre.",
    confirmPassword: "Confirmer le mot de passe temporaire",
    passwordMismatch: "Les mots de passe ne correspondent pas.",
    temporarySuccess:
      "Mot de passe temporaire attribué. Changement obligatoire à la prochaine connexion.",
    reactivate: "Réactiver",
    remove: "Supprimer",
    removeTitle: "Supprimer l’utilisateur ?",
    removeHelp:
      "sera supprimé définitivement uniquement s’il n’a jamais été utilisé et n’a aucune dépendance. Sinon, il sera désactivé en conservant l’historique.",
    toastRemoved: "Suppression terminée ; l’historique existant est conservé.",
  },
  de: {
    showPassword: "Passwort anzeigen",
    hidePassword: "Passwort verbergen",
    areaUnassigned: "Einsatzgebiet nicht zugewiesen",
    actions: "Aktionen",
    actionsFor: "Aktionen für {{username}}",
    temporaryAction: "Temporäres Passwort zuweisen",
    temporaryHelp:
      "Bisherige Sitzungen und Links werden widerrufen. Das Passwort muss vor der Nutzung des Dienstes geändert werden.",
    temporaryPolicy: "Mindestens 8 Zeichen, ein Buchstabe und eine Zahl.",
    confirmPassword: "Temporäres Passwort bestätigen",
    passwordMismatch: "Die Passwörter stimmen nicht überein.",
    temporarySuccess:
      "Temporäres Passwort zugewiesen. Änderung bei der nächsten Anmeldung erforderlich.",
    reactivate: "Reaktivieren",
    remove: "Löschen",
    removeTitle: "Benutzer löschen?",
    removeHelp:
      "wird nur endgültig gelöscht, wenn das Konto nie verwendet wurde und keine Abhängigkeiten bestehen. Andernfalls wird es mit erhaltenem Verlauf deaktiviert.",
    toastRemoved:
      "Entfernung abgeschlossen; vorhandener Verlauf wurde erhalten.",
  },
  ar: {
    showPassword: "إظهار كلمة المرور",
    hidePassword: "إخفاء كلمة المرور",
    areaUnassigned: "لم يتم تعيين منطقة العمل",
    actions: "الإجراءات",
    actionsFor: "إجراءات {{username}}",
    temporaryAction: "تعيين كلمة مرور مؤقتة",
    temporaryHelp:
      "سيتم إلغاء الجلسات وروابط الاستعادة السابقة. يجب على المستخدم تغيير كلمة المرور قبل استخدام الخدمة.",
    temporaryPolicy: "8 أحرف على الأقل مع حرف لاتيني ورقم.",
    confirmPassword: "تأكيد كلمة المرور المؤقتة",
    passwordMismatch: "كلمتا المرور غير متطابقتين.",
    temporarySuccess:
      "تم تعيين كلمة مرور مؤقتة. يجب تغييرها عند الدخول التالي.",
    reactivate: "إعادة التفعيل",
    remove: "حذف",
    removeTitle: "حذف المستخدم؟",
    removeHelp:
      "سيُحذف نهائيًا فقط إذا لم يُستخدم مطلقًا ولا توجد ارتباطات به. وإلا فسيتم تعطيله مع الاحتفاظ بالسجل.",
    toastRemoved: "اكتملت الإزالة مع الاحتفاظ بالسجل إن وجد.",
  },
} as const;

/** These new labels travel with the lazy Utenti page, preserving the entry budget. */
export function registerUtentiActions(
  instance: Pick<i18n, "addResourceBundle">,
) {
  for (const [language, labels] of Object.entries(utentiActions)) {
    instance.addResourceBundle(
      language,
      "translation",
      { utenti: labels },
      true,
      true,
    );
  }
}
