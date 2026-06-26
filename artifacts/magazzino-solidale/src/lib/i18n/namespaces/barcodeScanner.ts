export const barcodeScanner = {
  it: {
    button: "Scansiona",
    title: "Scansiona codice a barre",
    hint: "Inquadra il codice a barre con la fotocamera del dispositivo.",
    cancel: "Annulla",
    errPermission:
      "Accesso alla fotocamera negato. Consenti l'uso della fotocamera nelle impostazioni del browser e riprova.",
    errNoCamera: "Nessuna fotocamera trovata su questo dispositivo.",
    errGeneric: "Impossibile avviare la fotocamera. Riprova.",
    errInsecure: "La fotocamera richiede una connessione sicura (HTTPS).",
  },
  es: {
    button: "Escanear",
    title: "Escanear código de barras",
    hint: "Enfoca el código de barras con la cámara del dispositivo.",
    cancel: "Cancelar",
    errPermission:
      "Acceso a la cámara denegado. Permite el uso de la cámara en los ajustes del navegador e inténtalo de nuevo.",
    errNoCamera: "No se encontró ninguna cámara en este dispositivo.",
    errGeneric: "No se pudo iniciar la cámara. Inténtalo de nuevo.",
    errInsecure: "La cámara requiere una conexión segura (HTTPS).",
  },
  en: {
    button: "Scan",
    title: "Scan barcode",
    hint: "Point the device camera at the barcode.",
    cancel: "Cancel",
    errPermission:
      "Camera access denied. Allow camera use in your browser settings and try again.",
    errNoCamera: "No camera found on this device.",
    errGeneric: "Unable to start the camera. Please try again.",
    errInsecure: "The camera requires a secure (HTTPS) connection.",
  },
  fr: {
    button: "Scanner",
    title: "Scanner le code-barres",
    hint: "Visez le code-barres avec la caméra de l'appareil.",
    cancel: "Annuler",
    errPermission:
      "Accès à la caméra refusé. Autorisez l'utilisation de la caméra dans les paramètres du navigateur et réessayez.",
    errNoCamera: "Aucune caméra trouvée sur cet appareil.",
    errGeneric: "Impossible de démarrer la caméra. Réessayez.",
    errInsecure: "La caméra nécessite une connexion sécurisée (HTTPS).",
  },
  de: {
    button: "Scannen",
    title: "Barcode scannen",
    hint: "Richten Sie die Gerätekamera auf den Barcode.",
    cancel: "Abbrechen",
    errPermission:
      "Kamerazugriff verweigert. Erlauben Sie die Kameranutzung in den Browsereinstellungen und versuchen Sie es erneut.",
    errNoCamera: "Keine Kamera auf diesem Gerät gefunden.",
    errGeneric: "Kamera konnte nicht gestartet werden. Bitte erneut versuchen.",
    errInsecure: "Die Kamera erfordert eine sichere (HTTPS-)Verbindung.",
  },
  ar: {
    button: "مسح",
    title: "مسح الباركود",
    hint: "وجّه كاميرا الجهاز نحو الباركود.",
    cancel: "إلغاء",
    errPermission:
      "تم رفض الوصول إلى الكاميرا. اسمح باستخدام الكاميرا في إعدادات المتصفح وحاول مرة أخرى.",
    errNoCamera: "لم يتم العثور على كاميرا على هذا الجهاز.",
    errGeneric: "تعذّر تشغيل الكاميرا. حاول مرة أخرى.",
    errInsecure: "تتطلب الكاميرا اتصالاً آمناً (HTTPS).",
  },
} as const;
