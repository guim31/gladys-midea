// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status and the "Search for air conditioners" report (air
// conditioners and heat pumps alike). Four
// languages, the four of the Gladys interface; German says "du", Spanish
// "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Shown by Gladys under the integration name when it is not connected.
export const CONNECTION_TEXT = {
  noDevice: {
    en: 'No Midea air conditioner found. Check that it is on the same network as Gladys, or enter its IP address.',
    fr: "Aucun climatiseur Midea trouvé. Vérifiez qu'il est sur le même réseau que Gladys, ou saisissez son adresse IP.",
    de: 'Keine Midea-Klimaanlage gefunden. Prüfe, ob sie im selben Netzwerk wie Gladys ist, oder gib ihre IP-Adresse ein.',
    es: 'No se ha encontrado ningún aire acondicionado Midea. Compruebe que está en la misma red que Gladys o introduzca su dirección IP.',
  },
  noAnswer: {
    en: 'No Midea air conditioner answers.',
    fr: 'Aucun climatiseur Midea ne répond.',
    de: 'Keine Midea-Klimaanlage antwortet.',
    es: 'Ningún aire acondicionado Midea responde.',
  },
  noKeys: {
    en: 'A recent (V3) unit has no key: the Midea cloud could not give it. Run "Search for air conditioners" again, or check the cloud settings.',
    fr: "Un climatiseur récent (V3) n'a pas de clé : le cloud Midea n'a pas pu la donner. Relancez « Rechercher les climatiseurs » ou vérifiez les réglages du cloud.",
    de: 'Ein neueres Gerät (V3) hat keinen Schlüssel: Die Midea-Cloud konnte ihn nicht liefern. Starte „Klimaanlagen suchen“ erneut oder prüfe die Cloud-Einstellungen.',
    es: 'Un equipo reciente (V3) no tiene clave: la nube de Midea no ha podido darla. Vuelva a ejecutar «Buscar aires acondicionados» o revise los ajustes de la nube.',
  },
};

const MAX_LISTED = 8;

// The pieces of the "Search" report, one table per language.
export const SEARCH_TEXT = {
  en: {
    none: 'No Midea air conditioner found.',
    count: (total, reachable) => `${total} Midea unit(s), ${reachable} answering:`,
    answering: 'answers',
    unreachable: 'not answering',
    noKeys: 'no key from the Midea cloud',
    unsupported: (type, host) =>
      `Another Midea appliance (type ${type}) at ${host} is not supported.`,
    unavailable:
      'Automatic discovery through Gladys is unavailable (Gladys 5.2 or later needed): enter the IP addresses.',
    busy: 'A search has just run: the automatic discovery is available again in 10 seconds.',
    ignored: (list) => `Ignored addresses: ${list}.`,
  },
  fr: {
    none: 'Aucun climatiseur Midea trouvé.',
    count: (total, reachable) => `${total} appareil(s) Midea, ${reachable} répondent :`,
    answering: 'répond',
    unreachable: 'ne répond pas',
    noKeys: 'pas de clé du cloud Midea',
    unsupported: (type, host) =>
      `Un autre appareil Midea (type ${type}) en ${host} n'est pas pris en charge.`,
    unavailable:
      'La découverte automatique par Gladys est indisponible (Gladys 5.2 ou plus récent) : saisissez les adresses IP.',
    busy: 'Une recherche vient de tourner : la découverte automatique est de nouveau possible dans 10 secondes.',
    ignored: (list) => `Adresses ignorées : ${list}.`,
  },
  de: {
    none: 'Keine Midea-Klimaanlage gefunden.',
    count: (total, reachable) => `${total} Midea-Gerät(e), davon ${reachable} erreichbar:`,
    answering: 'antwortet',
    unreachable: 'antwortet nicht',
    noKeys: 'kein Schlüssel aus der Midea-Cloud',
    unsupported: (type, host) =>
      `Ein anderes Midea-Gerät (Typ ${type}) unter ${host} wird nicht unterstützt.`,
    unavailable:
      'Die automatische Erkennung über Gladys ist nicht verfügbar (Gladys 5.2 oder neuer nötig): Gib die IP-Adressen ein.',
    busy: 'Gerade lief eine Suche: Die automatische Erkennung ist in 10 Sekunden wieder möglich.',
    ignored: (list) => `Ignorierte Adressen: ${list}.`,
  },
  es: {
    none: 'No se ha encontrado ningún aire acondicionado Midea.',
    count: (total, reachable) => `${total} equipo(s) Midea, ${reachable} responde(n):`,
    answering: 'responde',
    unreachable: 'no responde',
    noKeys: 'sin clave de la nube de Midea',
    unsupported: (type, host) => `Otro aparato Midea (tipo ${type}) en ${host} no es compatible.`,
    unavailable:
      'El descubrimiento automático a través de Gladys no está disponible (se necesita Gladys 5.2 o posterior): introduzca las direcciones IP.',
    busy: 'Se acaba de realizar una búsqueda: el descubrimiento automático vuelve a estar disponible en 10 segundos.',
    ignored: (list) => `Direcciones ignoradas: ${list}.`,
  },
};

/**
 * The report of the "Search" action, in the four languages.
 * @param {object} summary hub.summary()
 */
export function searchMessage(summary) {
  const message = {};
  for (const [language, text] of Object.entries(SEARCH_TEXT)) {
    const lines = [];
    const devices = summary.devices;
    if (devices.length === 0) {
      lines.push(text.none);
    } else {
      const reachable = devices.filter((device) => device.status === 'answering').length;
      lines.push(text.count(devices.length, reachable));
      for (const device of devices.slice(0, MAX_LISTED)) {
        const status =
          device.status === 'answering'
            ? text.answering
            : device.status === 'no-keys'
              ? text.noKeys
              : text.unreachable;
        lines.push(`- ${device.names[language]} (${device.host}, V${device.version}): ${status}`);
      }
      if (devices.length > MAX_LISTED) {
        lines.push(`- … +${devices.length - MAX_LISTED}`);
      }
    }
    for (const other of summary.unsupported.slice(0, 3)) {
      lines.push(text.unsupported(other.type, other.host));
    }
    if (summary.scan === 'unavailable') {
      lines.push(text.unavailable);
    } else if (summary.scan === 'busy') {
      lines.push(text.busy);
    }
    if (summary.invalidHosts.length > 0) {
      lines.push(text.ignored(summary.invalidHosts.join(', ')));
    }
    message[language] = lines.join('\n');
  }
  return message;
}

// The intro of a diagnostic report (the report itself is in English, for the
// GitHub issue it is pasted into).
export const REPORT_INTROS = {
  masked: {
    en: 'Report below (also in the integration logs). Copy it as is into a GitHub issue: ids and serial numbers are shortened, local addresses hidden, and it never contains a token, a key nor a password.',
    fr: "Rapport ci-dessous (aussi dans les journaux de l'intégration). Copiez-le tel quel dans une issue GitHub : identifiants et numéros de série sont raccourcis, adresses locales masquées, et il ne contient jamais de jeton, de clé ni de mot de passe.",
    de: 'Bericht unten (auch in den Protokollen der Integration). Kopiere ihn unverändert in ein GitHub-Issue: IDs und Seriennummern sind gekürzt, lokale Adressen verborgen, und er enthält nie Token, Schlüssel oder Passwort.',
    es: 'Informe a continuación (también en los registros de la integración). Cópielo tal cual en una issue de GitHub: identificadores y números de serie acortados, direcciones locales ocultas, y nunca contiene token, clave ni contraseña.',
  },
  full: {
    en: 'Report below, WITH full ids, serial numbers and local addresses: do not post it publicly (the logs only keep the masked version). It never contains a token, a key nor a password.',
    fr: "Rapport ci-dessous, AVEC identifiants, numéros de série et adresses locales complets : ne le publiez pas (les journaux n'en gardent que la version masquée). Il ne contient jamais de jeton, de clé ni de mot de passe.",
    de: 'Bericht unten, MIT vollständigen IDs, Seriennummern und lokalen Adressen: nicht öffentlich posten (die Protokolle behalten nur die maskierte Fassung). Er enthält nie Token, Schlüssel oder Passwort.',
    es: 'Informe a continuación, CON identificadores, números de serie y direcciones locales completos: no lo publique (los registros solo guardan la versión ocultada). Nunca contiene token, clave ni contraseña.',
  },
};

export const DEVICE_REQUIRED = {
  en: 'Pick a unit in the list, or type its IP address.',
  fr: 'Choisissez un appareil dans la liste, ou saisissez son adresse IP.',
  de: 'Wähle ein Gerät in der Liste, oder gib seine IP-Adresse ein.',
  es: 'Elija un equipo en la lista, o escriba su dirección IP.',
};

/** A diagnostic report under its intro, in every language. */
export function reportMessage(report, includeIdentifiers) {
  const intro = REPORT_INTROS[includeIdentifiers ? 'full' : 'masked'];
  return Object.fromEntries(
    Object.entries(intro).map(([language, text]) => [language, `${text}\n\n${report}`]),
  );
}
