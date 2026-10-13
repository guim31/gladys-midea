// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`).
//
// Power, mode, setpoint and fan are already Gladys scene actions on the
// device features, one feature per action: four frames to the unit, four
// beeps, and the unit runs the intermediate states. `set_climate` sends them
// in a single frame, the unit switching on at once with the right settings.
//
// The triggers (src/hub.js) are fired by the readings, never as a consequence
// of this action: a scene bound to them cannot loop.
// -----------------------------------------------------------------------------

const given = (value) => value !== undefined && value !== null && String(value).trim() !== '';

export const SCENE_ACTIONS = {
  async set_climate(hub, { fields }) {
    const settings = { power: 1 };
    if (given(fields.mode)) {
      settings.mode = Number(fields.mode);
    }
    if (given(fields.target_temperature)) {
      settings.targetTemperature = Number(String(fields.target_temperature).replace(',', '.'));
    }
    if (given(fields.fan_speed)) {
      settings.fanSpeed = Number(fields.fan_speed);
    }
    const record = await hub.applySettings(fields.device, settings);
    return { target_temperature: record.state?.targetTemperature ?? null };
  },
};
