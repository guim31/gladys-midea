# Midea

Steuere deine Midea-Klimaanlagen aus Gladys, im lokalen Netzwerk: Ein/Aus, Modus, Sollwert, Lüfterstufe, Schwenken, Eco-, Turbo- und Nachtmodus, Innen- und Außentemperatur sowie den Energieverbrauch der Geräte, die ihn messen.

> Ohne die Hardware entwickelt: Rückmeldungen sind willkommen („Developed without the hardware: feedback welcome“). Diese Integration wurde mit aufgezeichneten Frames echter Geräte geschrieben und getestet, nicht mit einer physischen Klimaanlage. Melde auf [GitHub](https://github.com/guim31/gladys-midea/issues), was funktioniert und was nicht.

Diese Integration steht in keiner Verbindung zu Midea.

## Kompatible Hardware

Entscheidend ist die App, nicht die Marke auf dem Gerät: Eine Klimaanlage (Midea-Gerätetyp `0xAC`), deren WLAN-Modul in einer dieser Apps eingerichtet ist, funktioniert mit dieser Integration:

- **SmartHome / MSmartHome**, **NetHome Plus**, **Midea Air**, **Toshiba AC NA**, **Arctic King**.

Midea baut für viele Marken; Geräte verwandter Marken wie Comfee, Carrier oder mancher Toshiba-Serien nutzen oft diese Apps. Split-, Fenster- und mobile Geräte sprechen alle dasselbe Protokoll.

**Luft-Wasser-Wärmepumpen** (Midea-Gerätetyp `0xC3`, der „Heat Pump Wi-Fi Controller“ einer hydraulischen Wärmepumpe, z. B. Modell 171H120F) werden ebenfalls unterstützt: Heizzonen, Warmwasser, Eco- und leiser Modus, Wasser- und Außentemperaturen. Im Tab „Entdecken“ erscheinen sie wie die Klimaanlagen.

Nicht unterstützt: andere Midea-Geräte (Luftentfeuchter, Warmwasserbereiter...), die die Suche als „nicht unterstützt“ meldet, und die allerersten WLAN-Module (Protokoll V1, um 2015).

## Voraussetzungen

- Gladys **5.2.0** oder neuer.
- Die Klimaanlage im selben lokalen Netzwerk wie Gladys, einmal in ihrer App eingerichtet (das WLAN-Modul muss mit deinem Netzwerk verbunden sein).
- Für die seit etwa 2020 verkauften Geräte (Protokoll **V3**): **einmal** ein Internetzugang, um den Schlüssel des Geräts aus der Midea-Cloud zu holen. Danach ist alles lokal.

## Installation und Konfiguration

1. Öffne in Gladys **Integrationen → Von GitHub installieren** und gib `https://github.com/guim31/gladys-midea` ein.
2. Akzeptiere auf dem Installationsbildschirm die Anfrage zur **Netzwerkerkennung**: Gladys sendet die Midea-Suchanfrage für die Integration in dein Netzwerk (UDP-Ports 6445 und 20086).
3. Öffne den Tab **Konfiguration** der Integration. Die Einstellungen:
   - **IP-Adressen der Klimaanlagen**: optional, nur für Geräte, die die automatische Suche nicht findet (anderes Subnetz, Router, der Broadcasts filtert). Gib ihnen in deinem Router eine feste Adresse.
   - **Aktualisierungsintervall**: wie oft jedes Gerät gelesen wird (standardmäßig 30 Sekunden).
   - **Sprache der Gerätenamen**: Sprache der Namen neuer Geräte und ihrer Funktionen (standardmäßig Französisch).
   - **Piepton bei jedem Befehl**: standardmäßig aus, damit eine Szene in der Nacht still bleibt.
   - **Format der Energiedaten**: Lass „Standard (BCD)“, außer die angezeigte Leistung oder Energie ist unsinnig.
   - **Schlüssel neuerer Geräte (V3)**: die **Cloud-Region** des öffentlichen Kontos, mit dem die Schlüssel geholt werden (standardmäßig Europa), oder dein eigenes Konto, in **NetHome-Plus-Konto** und **NetHome-Plus-Passwort** (beide optional).
   - **Token und Schlüssel von Hand**: optional, nur für ein V3-Gerät, für das die Cloud keinen Schlüssel liefert (siehe unten).
4. Öffne den Tab **Entdecken**: Jedes gefundene Gerät erscheint als „Klimaanlage“, gefolgt von den letzten vier Zeichen seines WLAN-Namens. Füge die gewünschten zu Gladys hinzu.

Die Schaltfläche **Klimaanlagen suchen** (Tab Konfiguration) startet eine neue Suche und listet jedes gefundene Gerät mit Adresse, Protokoll und ob es antwortet.

### Zu den Schlüsseln der V3-Geräte

Ein V3-Gerät spricht nur mit einem Client, der sein Token und seinen Schlüssel kennt. Midea legt sie in seiner Cloud unter dem Gerät selbst ab, nicht unter einem Konto: Die Integration holt sie **einmal**, mit öffentlichen NetHome-Plus-Konten (die Praxis der freien Bibliotheken msmart-ng und midea-local) oder mit deinem eigenen Konto, wenn du es eingibst. Danach werden sie im Volume der Integration (`/data`) gespeichert und nie in die Protokolle geschrieben. Wird das Gerät zurückgesetzt oder in seiner App neu gekoppelt, bemerkt die Integration den abgelehnten Schlüssel und holt einen neuen.

## Geräte und Funktionen

Jede Klimaanlage ist ein Gladys-Gerät. Welche Funktionen es hat, hängt davon ab, was das Gerät meldet:

| Funktion                                             | Was sie tut                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Ein/Aus**                                          | Schaltet das Gerät ein oder aus.                                                                  |
| **Modus**                                            | Automatisch, Kühlen, Heizen, Entfeuchten, Nur Lüften (nur die Modi des Geräts).                   |
| **Solltemperatur**                                   | Der Sollwert, in halben Grad, wenn das Gerät sie annimmt, in seinem Bereich (meist 16 bis 30 °C). |
| **Lüfterstufe**                                      | Automatisch, Leise, Niedrig, Mittel, Hoch, Maximal (nur die Stufen des Geräts).                   |
| **Vertikales Schwenken**, **Horizontales Schwenken** | Schwenken oder fest, wenn das Gerät die Lamelle hat.                                              |
| **Innentemperatur**                                  | Die vom Innengerät gemessene Temperatur.                                                          |
| **Außentemperatur**                                  | Die vom Außengerät gemessene Temperatur, wenn es eine meldet.                                     |
| **Luftfeuchtigkeit innen**                           | Wenn das Gerät einen Feuchtesensor hat.                                                           |
| **Eco-Modus**, **Turbo**, **Nachtmodus**             | Die Voreinstellungen des Geräts. Eco und Turbo schließen sich aus.                                |
| **Leistungsaufnahme**, **Verbrauchte Energie**       | Momentanleistung (W) und Gesamtenergie (kWh), für Geräte mit Energiezähler.                       |

Änderungen per Fernbedienung oder App werden beim nächsten Lesen übernommen.

### Wärmepumpen

Eine Wärmepumpe (Typ `0xC3`) ist ein eigenes Gladys-Gerät, benannt „Wärmepumpe“, gefolgt von den letzten vier Zeichen ihres WLAN-Namens. Die Funktionen folgen der Anlage, die sie meldet (eine oder zwei Zonen, Warmwasser, nur Heizen oder Heizen und Kühlen):

| Funktion                                                                          | Was sie tut                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Modus Zone 1**, **Modus Zone 2**                                                | Aus, Heizen, Kühlen, Automatisch: Aus stoppt die Zone, die anderen Werte stellen den Betriebsmodus der Wärmepumpe ein, der für beide Zonen gilt. Zone 2 nur bei zwei Zonen.                                                           |
| **Sollwert Zone 1**, **Sollwert Zone 2**                                          | Die Wassertemperatur der Zone (ganze Grad) oder die Raumtemperatur bei einer Zone mit Raumthermostat (in halben Grad), innerhalb der Grenzen, die das Gerät meldet.                                                                   |
| **Warmwasser**, **Warmwasser-Sollwert**                                           | Warmwasser ein oder aus und sein Sollwert innerhalb der Grenzen des Geräts.                                                                                                                                                           |
| **Speichertemperatur**                                                            | Die im Speicher gemessene Temperatur.                                                                                                                                                                                                 |
| **Außentemperatur**, **Wassereintrittstemperatur**, **Wasseraustrittstemperatur** | Von Außen- und Hydraulikeinheit gemessen, wenn das Gerät sie liefert.                                                                                                                                                                 |
| **Betrieb Zone 1**, **Betrieb Zone 2**                                            | Ruhe, Heizen oder Kühlen: was die Zone gerade tut (Ruhe, wenn sie aus ist oder das Gerät Warmwasser bereitet).                                                                                                                        |
| **Heizkurve Zone 1**, **Heizkurve Zone 2**                                        | Der Wasser-Sollwert der Zone folgt der Außentemperatur (die an der Steuerung eingestellte Kurve).                                                                                                                                     |
| **Warmwasserbereitung**                                                           | Das Gerät heizt gerade das Warmwasser.                                                                                                                                                                                                |
| **Wasserdurchfluss**, **Wasserdruck**                                             | Durchfluss des Heizkreises (m³/h) und sein Druck (kPa).                                                                                                                                                                               |
| **Eco-Modus**, **Leiser Modus**, **Extra leiser Modus**                           | Die Voreinstellungen des Geräts. Der extra leise Modus ist die leiseste Stufe des leisen Modus, wenn das Gerät sie anbietet.                                                                                                          |
| **Verdichter**, **Abtauen**, **Elektrischer Zuheizer**                            | Ob der Verdichter läuft, die Außeneinheit abtaut, ein Heizstab (Zusatz oder Speicher) hilft.                                                                                                                                          |
| **Verdichter-Betriebsstunden**                                                    | Betriebsstunden des Verdichters, sobald das Gerät sie gesendet hat.                                                                                                                                                                   |
| **Fehlercode**                                                                    | Der Code, den die Steuerung anzeigt (E8, P1, H6...), oder „Kein Fehler“. Der Auslöser „Gerätefehler“ liefert ihn als `error_display`.                                                                                                 |
| **Leistungsaufnahme**                                                             | Die momentane Leistung (W), wenn das Gerät sie liefert.                                                                                                                                                                               |
| **Verbrauchte Energie**, **Erzeugte Wärme (kWh)**                                 | Insgesamt verbrauchter Strom und erzeugte Wärme (kWh), sobald das Gerät seine Zähler gesendet hat. Das Verhältnis beider ist die Jahresarbeitszahl (COP). Die Wärme ist ein einfacher Zähler, damit Gladys sie nicht als Strom zählt. |

Der Zusatzheizstab des Speichers, das schnelle Warmwasser und die Legionellen-Desinfektion bleiben dem Gerät und seiner Steuerung überlassen. Das Widget „Klimaanlage“ und die Szenenaktion „Klimaanlage starten“ sind nur für Klimaanlagen; der Auslöser „Gerätefehler“ funktioniert auch für Wärmepumpen. Die Unterstützung der Wärmepumpen wurde nach dem Code von midea-local geschrieben und wartet auf Rückmeldungen von echten Geräten.

## Widget

Das Widget **Klimaanlage** (wähle das Gerät in seinen Einstellungen) zeigt die Raumtemperatur, den Sollwert und die Außentemperatur (oder die Feuchte), dann den Modus, den Lüfter, den Filterzustand und den Fehlercode des Geräts. Seine Tasten:

- **Einschalten** / **Ausschalten**;
- **−0,5 °C** und **+0,5 °C** (in 1-°C-Schritten bei Geräten ohne halbe Grad);
- **Modus und Lüfter**: ein kleines Formular, um Modus und Lüfterstufe zusammen zu wählen; das Gerät wird eingeschaltet.

## Szenen-Auslöser

- **Filter muss gereinigt werden**: Das Gerät verlangt eine Reinigung seines Filters. Praktisch, um dir eine Nachricht zu schicken.
- **Gerätefehler**: Das Gerät meldet einen neuen Fehlercode. Der Code steht der Szene als Variable (`error_code`) zur Verfügung, etwa für eine Nachricht.

## Szenen-Aktion

- **Klimaanlage starten**: Schaltet das Gerät mit Modus, Sollwert und Lüfterstufe in **einem** Befehl ein (ein Piepton, kein Zwischenzustand), wo die Standardaktionen von Gladys einen Befehl pro Funktion senden würden. Ein leeres Feld behält die aktuelle Einstellung. Der Sollwert nimmt halbe Grad an (`24,5` oder `24.5`). Der übernommene Sollwert wird an die Szene zurückgegeben.

Zum Ausschalten oder um eine einzelne Einstellung zu ändern, nutze die Standardaktion „Ein Gerät steuern“ von Gladys.

## Szenenbeispiele

- **Schlafzimmer vor dem Schlafengehen kühlen**: um 21:30 Uhr, wenn das Schlafzimmer über 26 °C hat, „Klimaanlage starten“ in Kühlen auf 24 °C, Lüfter Leise, dann den Nachtmodus einschalten.
- **Niemand zu Hause**: Wenn die letzte Person geht, alle Klimaanlagen ausschalten.
- **Filter-Erinnerung**: bei „Filter muss gereinigt werden“ die Nachricht „Filter der Wohnzimmer-Klimaanlage reinigen“ senden.
- **Störungsalarm**: bei „Gerätefehler“ eine Nachricht mit dem Fehlercode (`error_code`) senden.

## Aktualisierung und Netzwerk

- Die Integration liest jedes Gerät selbst, standardmäßig alle 30 Sekunden, über das lokale Netzwerk (TCP-Port 6444). Die Abfrage durch Gladys dient nur als Rückfall. Jedes Lesen sind wenige kleine Frames: kein Internet, kein Kontingent.
- Nur geänderte Werte werden an Gladys gesendet, dazu alle 6 Stunden eine Erinnerung, damit ein stabiler Wert nie veraltet wirkt.
- Alle 30 Minuten läuft eine neue Suche, um einem Gerät mit geänderter Adresse zu folgen.
- Die Midea-Cloud wird nur kontaktiert, um den Schlüssel eines V3-Geräts zu holen, das noch keinen hat.

## Fehlerbehebung

- **Kein Gerät gefunden**: Prüfe, ob es in seiner App verbunden und im selben Netzwerk wie Gladys ist; gib seine IP-Adresse in der Konfiguration ein; starte **Klimaanlagen suchen**.
- **„Ein neueres Gerät (V3) hat keinen Schlüssel“**: Gladys konnte die Midea-Cloud nicht erreichen, oder das öffentliche Konto der Region kennt das Gerät nicht. Probiere eine andere **Cloud-Region** oder gib dein eigenes NetHome-Plus-Konto ein, dann starte **Klimaanlagen suchen** erneut.
- **Die Cloud liefert keinen Schlüssel** (manche Wärmepumpen): Wenn die Home-Assistant-Integration Midea AC LAN schon mit dem Gerät spricht, kopiere ihren Token und Schlüssel (aus ihrer gespeicherten Konfiguration) in **Token und Schlüssel von Hand**, als `token:schlüssel`, dann starte **Klimaanlagen suchen** erneut.
- **Das Gerät antwortet nicht**: Prüfe, ob es Strom hat und ob sich seine Adresse nicht geändert hat; ein Modul nimmt nur eine Verbindung gleichzeitig an, schließe also andere lokale Werkzeuge, die mit ihm sprechen.
- **Unsinnige Leistungs- oder Energiewerte**: Stelle das **Format der Energiedaten** auf „Binär“.
- **Mehr Details**: Setze die Umgebungsvariable `LOG_LEVEL` des Containers auf `debug`.

## Grenzen

- Ohne die Hardware entwickelt: Rückmeldungen sind auf [GitHub](https://github.com/guim31/gladys-midea/issues) willkommen.
- Nur Klimaanlagen und Luft-Wasser-Wärmepumpen: Luftentfeuchter und andere Midea-Geräte werden noch nicht unterstützt.
- Lamellenpositionen, die Anzeige (LED) und erweiterte Voreinstellungen (Breeze, iECO, Frischluft...) werden nicht unterstützt.
- Die Module der ersten Generation (V1) werden nicht unterstützt.
- Gladys zeigt den Sollwert auf manchen Bildschirmen in ganzen Grad; das Gerät selbst nimmt halbe Grad an.
- Der Schlüssel eines V3-Geräts braucht einmal die Midea-Cloud: Schließt Midea diesen Dienst, funktionieren bereits bekannte Geräte weiter.
