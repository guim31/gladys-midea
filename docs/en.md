# Midea

Control your Midea air conditioners from Gladys, on your local network: on/off, mode, setpoint, fan speed, swing, eco, turbo and sleep modes, indoor and outdoor temperature, and the energy consumption of the units that measure it.

> Developed without the hardware: feedback welcome. This integration was written and tested against recorded frames of real units, not against a physical air conditioner. Please report what works and what does not on [GitHub](https://github.com/guim31/gladys-midea/issues).

This integration is not affiliated with Midea.

## Compatible hardware

The criterion is the app, not the brand on the unit: an air conditioner (Midea appliance type `0xAC`) with a Wi-Fi module that is set up in one of these apps works with this integration:

- **SmartHome / MSmartHome**, **NetHome Plus**, **Midea Air**, **Toshiba AC NA**, **Arctic King**.

Midea builds units for many brands; units of related brands such as Comfee, Carrier or some Toshiba lines often use these apps. Split, window and portable units all speak the same protocol.

**Air-to-water heat pumps** (Midea appliance type `0xC3`, the "Heat Pump Wi-Fi Controller" of a hydronic heat pump, e.g. model 171H120F) are also supported: heating zones, domestic hot water, eco and silent modes, water and outdoor temperatures. They show up in the Discovery tab like the air conditioners.

Not supported: other Midea appliances (dehumidifiers, water heaters...), which the search lists as "not supported", and the very first Wi-Fi modules (protocol V1, around 2015).

## Requirements

- Gladys **5.2.0** or later.
- The air conditioner on the same local network as Gladys, set up once in its app (the Wi-Fi module must be connected to your network).
- For the units sold since about 2020 (protocol **V3**): an Internet access **once**, to fetch the unit's key from the Midea cloud. After that, everything is local.

## Installation and configuration

1. In Gladys, open **Integrations → Install from GitHub** and enter `https://github.com/guim31/gladys-midea`.
2. On the installation screen, accept the **network discovery** request: Gladys sends the Midea search request on your network (UDP ports 6445 and 20086) on behalf of the integration.
3. Open the integration's **Configuration** tab. The settings:
   - **IP addresses of the air conditioners**: optional, only for the units the automatic search does not find (another subnet, a router that filters broadcasts). Give them a fixed address in your router.
   - **Refresh interval**: how often each unit is read (30 seconds by default).
   - **Language of the device names**: language of the names given to the new devices and their features (French by default).
   - **Beep on each command**: off by default, so that a scene at night stays silent.
   - **Energy data format**: leave "Standard (BCD)" unless the power or energy shown is absurd.
   - **Keys of recent units (V3)**: the **Cloud region** of the public account used to fetch the keys (Europe by default), or your own account, in **NetHome Plus account** and **NetHome Plus password** (both optional).
   - **Token and key typed by hand**: optional, only for a V3 unit the cloud gives no key (see below).
4. Open the **Discovery** tab: every unit found appears, named "Air conditioner" followed by the last four characters of its Wi-Fi name. Add the ones you want to Gladys.

The **Search for air conditioners** button (Configuration tab) runs a new search and lists every unit found, its address, its protocol and whether it answers.

### About the keys of the V3 units

A V3 unit only talks to a client that knows its token and key. These are stored by Midea in its cloud, filed under the unit itself, not under an account: the integration fetches them **once**, with public NetHome Plus accounts (the practice of the open-source libraries msmart-ng and midea-local), or with your own account if you enter it. They are then saved in Gladys' integration volume (`/data`) and never written in the logs. If the unit is reset or paired again in its app, the integration notices the refused key and fetches a new one.

## Devices and features

Each air conditioner is one Gladys device. Its features depend on what the unit announces:

| Feature                                  | What it does                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **On/off**                               | Turns the unit on or off.                                                                       |
| **Mode**                                 | Auto, Cool, Heat, Dry, Fan only (only the modes the unit has).                                  |
| **Target temperature**                   | The setpoint, by half degrees when the unit takes them, within its range (16 to 30 °C usually). |
| **Fan speed**                            | Auto, Silent, Low, Medium, High, Maximum (only the speeds the unit has).                        |
| **Vertical swing**, **Horizontal swing** | Swing or fixed, when the unit has the louver.                                                   |
| **Indoor temperature**                   | The temperature measured by the indoor unit.                                                    |
| **Outdoor temperature**                  | The temperature measured by the outdoor unit, when it reports one.                              |
| **Indoor humidity**                      | When the unit has a humidity sensor.                                                            |
| **Eco mode**, **Turbo**, **Sleep mode**  | The unit's presets. Eco and Turbo exclude each other.                                           |
| **Power draw**, **Energy consumed**      | Instant power (W) and total energy (kWh), for the units with an energy meter.                   |

The changes made with the remote or the app are picked up at the next reading.

### Heat pumps

A heat pump (type `0xC3`) is a Gladys device of its own, named "Heat pump" followed by the last four characters of its Wi-Fi name. Its features follow the installation it announces (one or two zones, hot water, heating only or heating and cooling):

| Feature                                                                            | What it does                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Zone 1 mode**, **Zone 2 mode**                                                   | Off, Heat, Cool, Auto: Off stops the zone, the other values set the operating mode of the heat pump, shared by both zones. Zone 2 only with two zones.                                                                                 |
| **Zone 1 setpoint**, **Zone 2 setpoint**                                           | The water temperature of the zone (whole degrees), or the room temperature for a zone run by a room thermostat (by halves), within the limits the unit announces.                                                                      |
| **Hot water**, **Hot water setpoint**                                              | Domestic hot water on or off, and its setpoint within the unit's limits.                                                                                                                                                               |
| **Hot water tank temperature**                                                     | The temperature measured in the tank.                                                                                                                                                                                                  |
| **Outdoor temperature**, **Water inlet temperature**, **Water outlet temperature** | Measured by the outdoor and hydraulic units, when the unit gives them.                                                                                                                                                                 |
| **Zone 1 operation**, **Zone 2 operation**                                         | Idle, heating or cooling: what the zone is doing right now (idle when off or while the unit heats the hot water).                                                                                                                      |
| **Zone 1 weather curve**, **Zone 2 weather curve**                                 | The zone's water setpoint follows the outdoor temperature (the curve set on the controller).                                                                                                                                           |
| **Hot water heating**                                                              | The unit is heating the hot water right now.                                                                                                                                                                                           |
| **Water flow**, **Water pressure**                                                 | Flow of the heating loop (m³/h) and its pressure (kPa).                                                                                                                                                                                |
| **Eco mode**, **Silent mode**, **Super silent mode**                               | The presets of the unit. Super silent mode is the quietest level of silent mode, when the unit offers it.                                                                                                                              |
| **Compressor**, **Defrosting**, **Backup electric heater**                         | Whether the compressor runs, the outdoor unit defrosts, an electric heater (backup or tank) helps.                                                                                                                                     |
| **Compressor run time**                                                            | Hours of the compressor: it appears once the unit has sent it.                                                                                                                                                                         |
| **Error code**                                                                     | The code the controller shows (E8, P1, H6...), or "No error". The "Unit error" trigger gives it as `error_display`.                                                                                                                    |
| **Power draw**                                                                     | The instant power (W), when the unit gives it.                                                                                                                                                                                         |
| **Energy consumed**, **Heat produced (kWh)**                                       | Total electricity consumed and total heat produced (kWh): they appear once the unit has sent its counters. Their ratio is the seasonal efficiency (COP). The heat is a plain counter, so that Gladys does not count it as electricity. |

The tank booster heater, fast hot water and anti-legionella disinfection stay in the hands of the unit and its controller. The "Air conditioner" widget and the "Run the air conditioner" scene action are for air conditioners only; the "Unit error" trigger works for heat pumps too. Heat pump support was written from midea-local's code and is waiting for feedback on real units.

## Widget

The **Air conditioner** widget (choose the unit in its settings) shows the room temperature, the setpoint and the outdoor temperature (or the humidity), then the mode, the fan speed, the filter state and the error code of the unit. Its buttons:

- **Turn on** / **Turn off**;
- **−0.5 °C** and **+0.5 °C** (by 1 °C on the units that do not take half degrees);
- **Mode and fan**: a small form to choose the mode and the fan speed together; the unit is switched on.

## Scene triggers

- **Filter needs cleaning**: the unit asks for its filter to be cleaned. Useful to send yourself a message.
- **Unit error**: the unit reports a new error code. The code is available to the scene as a variable (`error_code`), to put in a message.

## Scene action

- **Run the air conditioner**: turns the unit on with its mode, setpoint and fan speed in **one** command (one beep, no intermediate state), where the standard Gladys actions would send one command per feature. An empty field keeps the current setting. The setpoint accepts half degrees (`24,5` or `24.5`). The setpoint applied is returned to the scene.

Turning the unit off, or changing a single setting, uses the standard "Control a device" action of Gladys.

## Scene examples

- **Cool the bedroom before bedtime**: at 9:30 pm, if the bedroom temperature is above 26 °C, "Run the air conditioner" in Cool at 24 °C, fan Silent, then turn on the Sleep mode.
- **Nobody home**: when the last person leaves, turn off every air conditioner.
- **Filter reminder**: on "Filter needs cleaning", send a message "Clean the filter of the living room air conditioner".
- **Breakdown alert**: on "Unit error", send a message with the error code (`error_code`).

## Refresh and network

- The integration reads each unit itself every 30 seconds by default, through the local network (TCP port 6444). Gladys' own polling is only a fallback. Each reading is a few small frames: no Internet, no quota.
- Only the values that changed are sent to Gladys, plus a reminder every 6 hours so that a stable value never looks stale.
- A new search runs every 30 minutes, to follow a unit whose address changed.
- The Midea cloud is only contacted to fetch the key of a V3 unit that has none yet.

## Troubleshooting

- **No unit found**: check that the unit is connected in its app and on the same network as Gladys; enter its IP address in the configuration; run **Search for air conditioners**.
- **"A recent (V3) unit has no key"**: Gladys could not reach the Midea cloud, or the public account of the region does not know the unit. Try another **Cloud region**, or enter your own NetHome Plus account, then run **Search for air conditioners** again.
- **The cloud gives no key** (some heat pumps): if Home Assistant's Midea AC LAN integration already talks to the unit, copy its token and key (in its saved configuration) into **Token and key typed by hand**, as `token:key`, then run **Search for air conditioners** again.
- **The unit does not answer**: check that it is powered and that its address did not change; a module only accepts one connection at a time, so close other local tools that talk to it.
- **Absurd power or energy values**: switch the **Energy data format** to "Binary".
- **More details**: set the `LOG_LEVEL` environment variable of the container to `debug`.

## Limits

- Developed without the hardware: feedback welcome on [GitHub](https://github.com/guim31/gladys-midea/issues).
- Air conditioners and air-to-water heat pumps only: dehumidifiers and other Midea appliances are not supported yet.
- The louver positions, the display (LED) and the advanced presets (breeze, iECO, fresh air...) are not handled.
- The first-generation modules (V1) are not supported.
- Gladys shows the setpoint by whole degrees on some screens; the unit itself takes half degrees.
- The key of a V3 unit needs the Midea cloud once: if Midea closes this service, units already known keep working.
