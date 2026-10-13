# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Local control of Midea air conditioners (appliance type `0xAC`) and of the
  units of related brands set up in the SmartHome / MSmartHome, NetHome Plus,
  Midea Air, Toshiba AC NA or Arctic King apps, over the Midea LAN protocol
  (V2 and V3).
- One Gladys device per unit: on/off, mode, setpoint (by half degrees), fan
  speed, vertical and horizontal swing, indoor and outdoor temperature, indoor
  humidity, eco, turbo and sleep modes, power draw and energy consumed — only
  the features and the options the unit announces.
- Automatic discovery through the Gladys core (mediated UDP broadcast on ports
  6445 and 20086), typed IP addresses for the units it does not find, and a
  "Search for air conditioners" action that lists every unit and its state.
- The key of the V3 units is fetched once from the Midea cloud (public
  NetHome Plus accounts by region, or your own account), kept in `/data`, and
  fetched again when the unit is paired again; everything else is local.
- The units are read by the integration itself every 30 seconds by default
  (15 s to 5 min), only the changes are sent to Gladys, with a reminder every
  6 hours.
- Scene triggers "Filter needs cleaning" and "Unit error" (with the error
  code), and a scene action "Run the air conditioner" that sets mode, setpoint
  and fan in one command.
- A dashboard widget "Air conditioner": room, setpoint and outdoor
  temperature, mode, fan, filter and error code, with on/off, setpoint and
  "Mode and fan" buttons.
- Names, messages and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-midea/commits/main
