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

async function main() {
  mixer = new Mixer();
  window.mixer = mixer; // for debugging

  const ui = new MixerUI(mixer);
  mixer.ui = ui;
  // Wire up rendering: called whenever mixer state changes
  mixer.onUIUpdate = () => ui.render();

  // MIDI
  midi = new MidiController(mixer);
  midi.onDevicesChanged = (devices) => ui.updateMIDIStatus(devices.map(d => d.name));
  await midi.enable();

  // Load global volume from storage and apply
  const vol = await Storage.getVolume();
  document.getElementById('globalVolume').value = vol * 100;
  mixer.master.effects.interfaceGain.set(vol);
}

main().catch(console.error);
