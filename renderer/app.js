/**
 * app.js — renderer entry point
 * Replaces soundscape.js (Foundry entry point)
 */
import { Mixer }          from './src/mixer.js';
import { MixerUI }        from './src/mixerUI.js';
import { MidiController } from './src/midi.js';
import { Storage }        from './src/storage.js';

let mixer;
let midi;

// ─── Window controls ───────────────────────────────────────────────────────
document.getElementById('winMinimize')?.addEventListener('click', () => window.api.win.minimize());
document.getElementById('winClose')?.addEventListener('click',    () => window.api.win.close());
document.getElementById('winMaximize')?.addEventListener('click', async () => {
  await window.api.win.maximize();
  const maximized = await window.api.win.isMaximized();
  const btn = document.getElementById('winMaximize');
  if (btn) btn.title = maximized ? 'Восстановить' : 'Развернуть';
  if (btn) btn.innerHTML = maximized ? '&#9635;' : '&#9633;';
});

async function main() {
  mixer = new Mixer();
  window.mixer = mixer; // for debugging

  const ui = new MixerUI(mixer);
  mixer.ui = ui;
  // Wire up rendering: called whenever mixer state changes
  mixer.onUIUpdate    = () => ui.render();
  mixer.onSceneRemoved = (idx) => ui.onSceneRemoved(idx);

  // MIDI
  midi = new MidiController(mixer);
  midi.onDevicesChanged  = (devices) => ui.updateMIDIStatus(devices.map(d => d.name));
  midi.onMappingCaptured = (key, data) => ui.onMappingCaptured(key, data);
  midi.onListeningStop   = (key)       => ui.onListeningStop(key);
  ui.midi = midi;
  await midi.enable();

  // Apply stored global volume to interface gain
  const vol = await Storage.getVolume();
  mixer.master.effects.interfaceGain.set(vol);
}

main().catch(console.error);
