# Midea

Pilotez vos climatiseurs Midea depuis Gladys, en réseau local : marche/arrêt, mode, consigne, vitesse de ventilation, balayage, modes éco, turbo et nuit, température intérieure et extérieure, et consommation d'énergie des climatiseurs qui la mesurent.

> Développée sans le matériel : vos retours sont les bienvenus (« Developed without the hardware: feedback welcome »). Cette intégration a été écrite et testée sur des trames enregistrées de vrais climatiseurs, pas sur un appareil physique. Dites ce qui marche et ce qui ne marche pas sur [GitHub](https://github.com/guim31/gladys-midea/issues).

Cette intégration n'est pas affiliée à Midea.

## Matériel compatible

Le critère est l'application, pas la marque sur l'appareil : un climatiseur (type d'appareil Midea `0xAC`) dont le module Wi-Fi est configuré dans l'une de ces applications fonctionne avec cette intégration :

- **SmartHome / MSmartHome**, **NetHome Plus**, **Midea Air**, **Toshiba AC NA**, **Arctic King**.

Midea fabrique pour de nombreuses marques ; les climatiseurs de marques liées comme Comfee, Carrier ou certaines gammes Toshiba utilisent souvent ces applications. Les splits, climatiseurs de fenêtre et mobiles parlent tous le même protocole.

Les **pompes à chaleur air/eau** (type d'appareil Midea `0xC3`, le « Heat Pump Wi-Fi Controller » d'une pompe à chaleur hydraulique, par exemple le modèle 171H120F) sont aussi prises en charge : zones de chauffage, eau chaude sanitaire, modes éco et silencieux, températures d'eau et extérieure. Elles apparaissent dans l'onglet Découverte comme les climatiseurs.

Non pris en charge : les autres appareils Midea (déshumidificateurs, chauffe-eau...), que la recherche signale « non pris en charge », et les tout premiers modules Wi-Fi (protocole V1, vers 2015).

## Prérequis

- Gladys **5.2.0** ou plus récent.
- Le climatiseur sur le même réseau local que Gladys, configuré une fois dans son application (le module Wi-Fi doit être connecté à votre réseau).
- Pour les climatiseurs vendus depuis 2020 environ (protocole **V3**) : un accès à Internet **une seule fois**, pour obtenir la clé de l'appareil auprès du cloud Midea. Ensuite, tout est local.

## Installation et configuration

1. Dans Gladys, ouvrez **Intégrations → Installer depuis GitHub** et saisissez `https://github.com/guim31/gladys-midea`.
2. Sur l'écran d'installation, acceptez la demande de **découverte réseau** : Gladys envoie la requête de recherche Midea sur votre réseau (ports UDP 6445 et 20086) pour le compte de l'intégration.
3. Ouvrez l'onglet **Configuration** de l'intégration. Les réglages :
   - **Adresses IP des climatiseurs** : facultatif, seulement pour les climatiseurs que la recherche automatique ne trouve pas (autre sous-réseau, routeur qui filtre les diffusions). Donnez-leur une adresse fixe dans votre box.
   - **Intervalle d'actualisation** : fréquence de lecture de chaque climatiseur (30 secondes par défaut).
   - **Langue des noms des appareils** : langue des noms donnés aux nouveaux appareils et à leurs fonctionnalités (français par défaut).
   - **Bip à chaque commande** : désactivé par défaut, pour qu'une scène de nuit reste silencieuse.
   - **Format des données d'énergie** : laissez « Standard (BCD) » sauf si la puissance ou l'énergie affichée est absurde.
   - **Clés des climatiseurs récents (V3)** : la **Région du cloud** du compte public qui sert à obtenir les clés (Europe par défaut), ou votre propre compte, dans **Compte NetHome Plus** et **Mot de passe NetHome Plus** (facultatifs).
   - **Jeton et clé saisis à la main** : facultatif, seulement pour un appareil V3 dont le cloud ne donne pas la clé (voir plus bas).
4. Ouvrez l'onglet **Découverte** : chaque climatiseur trouvé apparaît, nommé « Climatiseur » suivi des quatre derniers caractères de son nom Wi-Fi. Ajoutez à Gladys ceux que vous voulez.

Le bouton **Rechercher les climatiseurs** (onglet Configuration) relance une recherche et liste chaque climatiseur trouvé, son adresse, son protocole et s'il répond.

### À propos des clés des climatiseurs V3

Un climatiseur V3 ne parle qu'à un client qui connaît son jeton et sa clé. Midea les range dans son cloud, au nom de l'appareil lui-même et non d'un compte : l'intégration les obtient **une seule fois**, avec des comptes NetHome Plus publics (la pratique des bibliothèques libres msmart-ng et midea-local), ou avec votre propre compte si vous le saisissez. Ils sont ensuite enregistrés dans le volume de l'intégration (`/data`) et jamais écrits dans les journaux. Si l'appareil est réinitialisé ou réappairé dans son application, l'intégration voit la clé refusée et en obtient une nouvelle.

## Appareils et fonctionnalités

Chaque climatiseur est un appareil Gladys. Ses fonctionnalités dépendent de ce que l'appareil annonce :

| Fonctionnalité                                 | Ce qu'elle fait                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Marche/arrêt**                               | Allume ou éteint le climatiseur.                                                                 |
| **Mode**                                       | Auto, Froid, Chaud, Déshumidification, Ventilation (seulement les modes de l'appareil).          |
| **Température de consigne**                    | La consigne, par demi-degré quand l'appareil les accepte, dans sa plage (16 à 30 °C en général). |
| **Vitesse de ventilation**                     | Auto, Silencieux, Basse, Moyenne, Haute, Maximale (seulement les vitesses de l'appareil).        |
| **Balayage vertical**, **Balayage horizontal** | Balayage ou fixe, quand l'appareil a le volet.                                                   |
| **Température intérieure**                     | La température mesurée par l'unité intérieure.                                                   |
| **Température extérieure**                     | La température mesurée par l'unité extérieure, quand elle en donne une.                          |
| **Humidité intérieure**                        | Quand l'appareil a une sonde d'humidité.                                                         |
| **Mode éco**, **Turbo**, **Mode nuit**         | Les préréglages de l'appareil. Éco et Turbo s'excluent.                                          |
| **Puissance consommée**, **Énergie consommée** | Puissance instantanée (W) et énergie totale (kWh), pour les appareils avec compteur d'énergie.   |

Les changements faits avec la télécommande ou l'application sont repris à la lecture suivante.

### Pompes à chaleur

Une pompe à chaleur (type `0xC3`) est un appareil Gladys à part, nommé « Pompe à chaleur » suivi des quatre derniers caractères de son nom Wi-Fi. Ses fonctionnalités suivent l'installation qu'elle annonce (une ou deux zones, eau chaude, chauffage seul ou chauffage et rafraîchissement) :

| Fonctionnalité                                                                              | Ce qu'elle fait                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mode zone 1**, **Mode zone 2**                                                            | Arrêt, Chaud, Froid, Auto : Arrêt coupe la zone, les autres valeurs règlent le mode de fonctionnement de la pompe à chaleur, commun aux deux zones. Zone 2 seulement avec deux zones.                                                                                       |
| **Consigne zone 1**, **Consigne zone 2**                                                    | La température d'eau de la zone (degrés entiers), ou la température de la pièce pour une zone pilotée par un thermostat d'ambiance (par demi-degré), dans les limites annoncées par l'appareil.                                                                             |
| **Eau chaude**, **Consigne d'eau chaude**                                                   | Eau chaude sanitaire en marche ou arrêtée, et sa consigne dans les limites de l'appareil.                                                                                                                                                                                   |
| **Température du ballon**                                                                   | La température mesurée dans le ballon.                                                                                                                                                                                                                                      |
| **Température extérieure**, **Température d'entrée d'eau**, **Température de sortie d'eau** | Mesurées par les unités extérieure et hydraulique, quand l'appareil les donne.                                                                                                                                                                                              |
| **Fonctionnement zone 1**, **Fonctionnement zone 2**                                        | Repos, chauffe ou rafraîchissement : ce que fait la zone en ce moment (repos quand elle est arrêtée ou pendant que l'appareil chauffe l'eau chaude).                                                                                                                        |
| **Loi d'eau zone 1**, **Loi d'eau zone 2**                                                  | La consigne d'eau de la zone suit la température extérieure (la courbe réglée sur la commande).                                                                                                                                                                             |
| **Chauffe de l'eau chaude**                                                                 | L'appareil chauffe l'eau chaude en ce moment.                                                                                                                                                                                                                               |
| **Débit d'eau**, **Pression d'eau**                                                         | Débit du circuit de chauffage (m³/h) et sa pression (kPa).                                                                                                                                                                                                                  |
| **Mode éco**, **Mode silencieux**, **Mode super silencieux**                                | Les préréglages de l'appareil. Le mode super silencieux est le niveau le plus discret du mode silencieux, quand l'appareil le propose.                                                                                                                                      |
| **Compresseur**, **Dégivrage**, **Appoint électrique**                                      | Le compresseur tourne, l'unité extérieure dégivre, une résistance électrique (appoint ou ballon) aide.                                                                                                                                                                      |
| **Heures du compresseur**                                                                   | Heures de fonctionnement du compresseur : elles apparaissent dès que l'appareil les a envoyées.                                                                                                                                                                             |
| **Code erreur**                                                                             | Le code affiché par la commande (E8, P1, H6...), ou « Aucune erreur ». Le déclencheur « Erreur du climatiseur » le donne dans `error_display`.                                                                                                                              |
| **Puissance consommée**                                                                     | La puissance instantanée (W), quand l'appareil la donne.                                                                                                                                                                                                                    |
| **Énergie consommée**, **Chaleur produite (kWh)**                                           | L'électricité consommée et la chaleur produite au total (kWh) : elles apparaissent dès que l'appareil a envoyé ses compteurs. Leur rapport donne le rendement saisonnier (COP). La chaleur est un simple compteur, pour que Gladys ne la compte pas comme de l'électricité. |

L'appoint électrique du ballon, l'eau chaude rapide et la désinfection anti-légionellose restent entre les mains de l'appareil et de sa commande. Le widget « Climatiseur » et l'action de scène « Lancer la climatisation » sont réservés aux climatiseurs ; le déclencheur « Erreur du climatiseur » fonctionne aussi pour les pompes à chaleur. La prise en charge des pompes à chaleur a été écrite d'après le code de midea-local et attend des retours sur de vrais appareils.

## Widget

Le widget **Climatiseur** (choisissez l'appareil dans ses réglages) montre la température de la pièce, la consigne et la température extérieure (ou l'humidité), puis le mode, la ventilation, l'état du filtre et le code erreur de l'appareil. Ses boutons :

- **Allumer** / **Éteindre** ;
- **−0,5 °C** et **+0,5 °C** (par 1 °C sur les appareils qui n'acceptent pas les demi-degrés) ;
- **Mode et ventilation** : un petit formulaire pour choisir ensemble le mode et la vitesse de ventilation ; le climatiseur est allumé.

## Déclencheurs de scène

- **Filtre à nettoyer** : le climatiseur demande le nettoyage de son filtre. Pratique pour vous envoyer un message.
- **Erreur du climatiseur** : le climatiseur signale un nouveau code erreur. Le code est disponible dans la scène comme variable (`error_code`), à mettre dans un message.

## Action de scène

- **Lancer la climatisation** : allume le climatiseur avec son mode, sa consigne et sa ventilation en **une seule** commande (un seul bip, pas d'état intermédiaire), là où les actions standard de Gladys enverraient une commande par fonctionnalité. Un champ vide garde le réglage actuel. La consigne accepte les demi-degrés (`24,5` ou `24.5`). La consigne appliquée est renvoyée à la scène.

Pour éteindre le climatiseur, ou changer un seul réglage, utilisez l'action standard « Contrôler un appareil » de Gladys.

## Exemples de scènes

- **Rafraîchir la chambre avant le coucher** : à 21 h 30, si la chambre dépasse 26 °C, « Lancer la climatisation » en Froid à 24 °C, ventilation Silencieux, puis activer le Mode nuit.
- **Plus personne à la maison** : quand la dernière personne part, éteindre tous les climatiseurs.
- **Rappel du filtre** : sur « Filtre à nettoyer », envoyer le message « Nettoyer le filtre du climatiseur du salon ».
- **Alerte panne** : sur « Erreur du climatiseur », envoyer un message avec le code erreur (`error_code`).

## Rafraîchissement et réseau

- L'intégration lit elle-même chaque climatiseur toutes les 30 secondes par défaut, par le réseau local (port TCP 6444). Le sondage de Gladys ne sert que de secours. Chaque lecture tient en quelques petites trames : pas d'Internet, pas de quota.
- Seules les valeurs qui changent sont envoyées à Gladys, plus un rappel toutes les 6 heures pour qu'une valeur stable ne paraisse jamais ancienne.
- Une nouvelle recherche tourne toutes les 30 minutes, pour suivre un climatiseur dont l'adresse a changé.
- Le cloud Midea n'est contacté que pour obtenir la clé d'un climatiseur V3 qui n'en a pas encore.

## Dépannage

- **Aucun climatiseur trouvé** : vérifiez qu'il est connecté dans son application et sur le même réseau que Gladys ; saisissez son adresse IP dans la configuration ; lancez **Rechercher les climatiseurs**.
- **« Un climatiseur récent (V3) n'a pas de clé »** : Gladys n'a pas pu joindre le cloud Midea, ou le compte public de la région ne connaît pas l'appareil. Essayez une autre **Région du cloud**, ou saisissez votre propre compte NetHome Plus, puis relancez **Rechercher les climatiseurs**.
- **Le cloud ne donne pas de clé** (certaines pompes à chaleur) : si l'intégration Midea AC LAN de Home Assistant parle déjà à l'appareil, recopiez son jeton et sa clé (dans sa configuration enregistrée) dans **Jeton et clé saisis à la main**, sous la forme `jeton:clé`, puis relancez **Rechercher les climatiseurs**.
- **Le climatiseur ne répond pas** : vérifiez qu'il est alimenté et que son adresse n'a pas changé ; un module n'accepte qu'une connexion à la fois, fermez les autres outils locaux qui lui parlent.
- **Puissance ou énergie absurdes** : passez le **Format des données d'énergie** sur « Binaire ».
- **Plus de détails** : mettez la variable d'environnement `LOG_LEVEL` du conteneur à `debug`.

## Limites

- Développée sans le matériel : vos retours sont les bienvenus sur [GitHub](https://github.com/guim31/gladys-midea/issues).
- Climatiseurs et pompes à chaleur air/eau seulement : les déshumidificateurs et autres appareils Midea ne sont pas encore pris en charge.
- Les positions des volets, l'afficheur (LED) et les préréglages avancés (breeze, iECO, air frais...) ne sont pas gérés.
- Les modules de première génération (V1) ne sont pas pris en charge.
- Gladys affiche la consigne par degré entier sur certains écrans ; l'appareil, lui, accepte les demi-degrés.
- La clé d'un climatiseur V3 demande le cloud Midea une fois : si Midea ferme ce service, les appareils déjà connus continuent de fonctionner.
