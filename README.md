# Midea for Gladys Assistant

Local control of **Midea air conditioners** and **air-to-water heat pumps**, and of the units of related brands set up in the same apps, from [Gladys Assistant](https://gladysassistant.com): on/off, mode, setpoint, fan speed, swing, eco, turbo and sleep modes, indoor and outdoor temperature, humidity and energy consumption, over the Midea LAN protocol (TCP port 6444).

> **Developed without the hardware: feedback welcome.** The protocol code is a port of [msmart-ng](https://github.com/mill1000/midea-msmart) and [midea-local](https://github.com/midea-lan/midea-local), checked byte for byte against msmart-ng on real frames from its test suite, but it has not run against a physical unit yet. Please report what works and what does not in the [issues](https://github.com/guim31/gladys-midea/issues).

This project is not affiliated with Midea.

## What it does

- **Discovery**: the units on the same network as Gladys are found through the Gladys core (mediated UDP broadcast, ports 6445 and 20086); a unit on another subnet is reached by its typed IP address.
- **One Gladys device per unit**, with only the features and options the unit announces: on/off, mode (auto, cool, heat, dry, fan), setpoint by half degrees, fan speed, vertical and horizontal swing, indoor and outdoor temperature, indoor humidity, eco, turbo and sleep modes, power draw and energy consumed.
- **Air-to-water heat pumps** (appliance type `0xC3`, "Heat Pump Wi-Fi Controller", e.g. 171H120F): mode, setpoint, operating state and weather curve of each heating zone, domestic hot water on/off, setpoint and heating, tank, outdoor and water temperatures, water flow and pressure, eco, silent and super silent modes, compressor, defrosting, backup heater, error code, power draw, energy consumed and heat produced. Ported from midea-local, waiting for feedback on real units.
- **V2 and V3 units**: the units sold since about 2020 (V3) need a token and a key, fetched **once** from the Midea cloud (public NetHome Plus accounts by region, as msmart-ng does, or your own account), then kept in the integration volume (`/data`). Everything else is local.
- **Refresh**: the integration reads every unit itself, every 30 seconds by default, and sends Gladys only what changed.
- **Scenes**: triggers "Filter needs cleaning" and "Unit error" (with the error code); action "Run the air conditioner" (mode, setpoint and fan in one command).
- **Widget** "Air conditioner": room, setpoint and outdoor temperature, mode, fan, filter, error code; on/off, setpoint and "Mode and fan" buttons.
- **Diagnostics**: "Diagnostic of the units" and "Test a unit" build a read-only text report to paste into a GitHub issue (secrets never shown, identifiers masked by default); the test of a typed address tells which Midea appliance answers there.
- English, French, German and Spanish.

The criterion is the app the unit is set up in: SmartHome / MSmartHome, NetHome Plus, Midea Air, Toshiba AC NA or Arctic King (appliance type `0xAC`). See the [documentation](docs/en.md) ([français](docs/fr.md), [Deutsch](docs/de.md), [español](docs/es.md)).

## Requirements

- Gladys Assistant **5.2.0** or later (mediated network discovery, widget buttons with a form).
- The air conditioner set up in its app and on the same local network as Gladys.
- For a V3 unit, Internet access once, to fetch its key.

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter this repository's URL, accept the network discovery request, then open the **Discovery** tab of the integration and add your units. The settings are described in the [documentation](docs/en.md).

## Limits

- Air conditioners and air-to-water heat pumps only: Midea dehumidifiers and other appliances are listed by the search as "not supported".
- Heat pumps: the tank booster heater, fast hot water and disinfection are left to the unit; the widget and the scene action are for air conditioners.
- Louver positions, the display (LED) and the advanced presets (breeze, iECO, fresh air...) are not handled.
- First-generation modules (V1) are not supported.
- The key of a V3 unit needs the Midea cloud once; a unit already known keeps working without it.

## Development

```bash
npm install
npm test               # node --test: protocol, hub, widget, scenes, Gladys rules, languages
npm run lint
npm run format:check
node scripts/probe.mjs --cloud              # read-only check of the Midea cloud (needs Internet)
node scripts/probe.mjs --host 192.168.1.60  # read-only check of a real unit (air conditioner or heat pump)
```

The tests never touch the network: `test/fixtures/msmart-vectors.json` holds packets, envelopes and decodings produced by msmart-ng itself on fixed inputs (anonymized), and `test/helpers/fakeMidea.js` simulates units speaking the V2 and V3 protocols. See [CLAUDE.md](CLAUDE.md) for the project rules.

## Credits

- [msmart-ng](https://github.com/mill1000/midea-msmart) by Tucker Kern and contributors (MIT): LAN packets, V3 handshake, air conditioner commands and responses, NetHome Plus cloud client, and the frames of its test suite used as fixtures.
- [midea-local](https://github.com/midea-lan/midea-local) by George Zhao, Wentao Wu and contributors (MIT), the library of the Home Assistant integration [midea_ac_lan](https://github.com/wuwentao/midea_ac_lan): discovery, V3 protocol, the heat pump (0xC3) frames, cross-checks.
- The MIT notices of both projects are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), shipped in the image.
- Built from the official [integration template](https://github.com/GladysAssistant/integration-template-js) of Gladys Assistant.

## License

[Apache-2.0](LICENSE).
