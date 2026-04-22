/**
 * midi.js — Web MIDI API integration.
 *
 * Supports two modes:
 *   Normal   — incoming messages are routed to mixer actions via stored mappings.
 *   Listening — waiting to capture the next matching message for a specific entity.
 *
 * Entity keys:
 *   ch-{i}-mute / solo / volume / play / prev / next
 *   master-volume / master-play
 *   sb-stopall
 *   sb-{i}   (soundboard button 0–24)
 *
 * Message types:
 *   volume entities → pitchbend  (0xE0, 14-bit, channel-scoped)
 *   all others      → noteon     (0x90, channel + note)
 */
import { Storage } from './storage.js';

export class MidiController {
  constructor(mixer) {
    this.mixer          = mixer;
    this.enabled        = false;
    this.devices        = [];
    this.mappings       = {};     // entityKey → { type, channel, note? }
    this._listeningFor  = null;   // entityKey currently being mapped
    this._listeningType = null;   // 'noteon' | 'pitchbend'
    this._access        = null;

    // Callbacks — set by the UI
    this.onDevicesChanged  = null;  // (devices[]) → void
    this.onMappingCaptured = null;  // (entityKey, mappingData) → void
    this.onListeningStop   = null;  // (entityKey) → void  — fired on explicit stop/cancel
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async enable() {
    this.mappings = await Storage.getMidiMappings();
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI API not supported');
      return false;
    }
    try {
      this._access = await navigator.requestMIDIAccess({ sysex: false });
      this._access.onstatechange = () => this._refreshDevices();
      this._refreshDevices();
      this.enabled = true;
      return true;
    } catch (err) {
      console.warn('MIDI access denied:', err);
      return false;
    }
  }

  disable() {
    if (this._access) {
      this._access.inputs.forEach(input => { input.onmidimessage = null; });
    }
    this.enabled = false;
    this.devices = [];
  }

  _refreshDevices() {
    if (!this._access) return;
    this.devices = [];
    this._access.inputs.forEach(input => {
      input.onmidimessage = (msg) => this._onMessage(msg);
      this.devices.push({ id: input.id, name: input.name, state: input.state });
    });
    if (this.onDevicesChanged) this.onDevicesChanged(this.devices);
  }

  // ── Mapping capture ────────────────────────────────────────────────────────

  /**
   * Start waiting for the next MIDI message for the given entity.
   * If another entity was already listening, it is silently cancelled first
   * (fires onListeningStop for the old entity).
   */
  startListening(entityKey, type) {
    if (this._listeningFor && this._listeningFor !== entityKey) {
      // Cancel the previous listener and notify UI
      const prev = this._listeningFor;
      this._listeningFor  = null;
      this._listeningType = null;
      if (this.onListeningStop) this.onListeningStop(prev);
    }
    this._listeningFor  = entityKey;
    this._listeningType = type;
  }

  /** Explicitly cancel listening (fires onListeningStop). */
  stopListening() {
    if (!this._listeningFor) return;
    const prev = this._listeningFor;
    this._listeningFor  = null;
    this._listeningType = null;
    if (this.onListeningStop) this.onListeningStop(prev);
  }

  /** Cancel without firing any callback (used when exiting mapping mode). */
  cancelListening() {
    this._listeningFor  = null;
    this._listeningType = null;
  }

  isListening()    { return this._listeningFor !== null; }
  getListeningFor() { return this._listeningFor; }

  // ── Mapping storage ────────────────────────────────────────────────────────

  getMappings() { return this.mappings; }

  async setMapping(entityKey, data) {
    this.mappings[entityKey] = data;
    await Storage.setMidiMappings(this.mappings);
  }

  async clearMapping(entityKey) {
    delete this.mappings[entityKey];
    await Storage.setMidiMappings(this.mappings);
  }

  // ── Message handling ───────────────────────────────────────────────────────

  _onMessage(msg) {
    const [status, data1, data2] = msg.data;
    const type    = status & 0xF0;
    const channel = status & 0x0F;

    if (this._listeningFor) {
      if (this._listeningType === 'noteon' && type === 0x90 && data2 > 0) {
        this._captureMapping({ type: 'noteon', channel, note: data1 });
      } else if (this._listeningType === 'pitchbend' && type === 0xE0) {
        this._captureMapping({ type: 'pitchbend', channel });
      } else if (this._listeningType === 'volume_any') {
        // Accept either PitchBend (absolute) or CC (relative) for ambient volumes
        if (type === 0xE0) {
          this._captureMapping({ type: 'pitchbend', channel });
        } else if (type === 0xB0 && data2 > 0) {
          this._captureMapping({ type: 'cc_relative', channel, cc: data1 });
        }
      }
      return;
    }

    // Normal routing
    if      (type === 0x90 && data2 > 0) this._dispatchNoteOn(channel, data1);
    else if (type === 0xE0)              this._dispatchPitchBend(channel, data1, data2);
    else if (type === 0xB0 && data2 > 0) this._dispatchCC(channel, data1, data2);
  }

  async _captureMapping(data) {
    const entityKey = this._listeningFor;
    // Clear listening state silently (no onListeningStop — onMappingCaptured handles UI)
    this._listeningFor  = null;
    this._listeningType = null;
    await this.setMapping(entityKey, data);
    if (this.onMappingCaptured) this.onMappingCaptured(entityKey, data);
  }

  // ── Normal-mode dispatch ───────────────────────────────────────────────────

  _dispatchNoteOn(channel, note) {
    for (const [key, m] of Object.entries(this.mappings)) {
      if (m.type === 'noteon' && m.channel === channel && m.note === note) {
        this._executeAction(key);
      }
    }
  }

  _dispatchPitchBend(channel, lsb, msb) {
    // 14-bit pitchbend → 0..1
    const value = ((msb << 7) | lsb) / 16383;
    for (const [key, m] of Object.entries(this.mappings)) {
      if (m.type === 'pitchbend' && m.channel === channel) {
        this._executeVolumeAction(key, value * 1.25);
      }
    }
  }

  _executeAction(entityKey) {
    const mixer = this.mixer;
    if (!mixer) return;

    let m;

    if ((m = entityKey.match(/^ch-(\d+)-mute$/))) {
      const i = +m[1], ch = mixer.channels[i];
      if (ch) { ch.setMute(!ch.getMute()); mixer.ui?.updateMute(i, ch.getMute()); }
      return;
    }
    if ((m = entityKey.match(/^ch-(\d+)-solo$/))) {
      mixer.toggleSolo(+m[1]);
      return;
    }
    if ((m = entityKey.match(/^ch-(\d+)-play$/))) {
      const i = +m[1], ch = mixer.channels[i];
      if (ch) {
        if (ch.playing) mixer.stop(i); else mixer.start(i);
        mixer.ui?.updatePlayState();
      }
      return;
    }
    if ((m = entityKey.match(/^ch-(\d+)-prev$/))) {
      mixer.channels[+m[1]]?.previous(); return;
    }
    if ((m = entityKey.match(/^ch-(\d+)-next$/))) {
      mixer.channels[+m[1]]?.next(); return;
    }
    if (entityKey === 'master-play') {
      if (mixer.playing) mixer.stop(); else mixer.start();
      mixer.ui?.updatePlayState();
      return;
    }
    if (entityKey === 'sb-stopall') {
      mixer.soundboard.stopAll(); return;
    }
    if ((m = entityKey.match(/^sb-(\d+)$/))) {
      const i = +m[1];
      mixer.soundboard.playSound(i);
      mixer.ui?.flashSoundboardButton(i);
      return;
    }
    if ((m = entityKey.match(/^scene-(\d+)$/))) {
      mixer.switchScene(+m[1]);
      return;
    }
  }

  _dispatchCC(channel, ccNum, value) {
    // value < 64  → increment, value >= 64 → decrement (relative encoder convention)
    const delta = value < 64 ? value * 0.01 : -(value - 64) * 0.01;
    for (const [key, m] of Object.entries(this.mappings)) {
      if (m.type === 'cc_relative' && m.channel === channel && m.cc === ccNum) {
        this._executeRelativeVolumeAction(key, delta);
      }
    }
  }

  async _executeRelativeVolumeAction(entityKey, delta) {
    const mixer = this.mixer;
    if (!mixer) return;

    if (entityKey === 'amb-master-volume') {
      const newVol = Math.max(0, Math.min(1.25, mixer.ambientMixer.getMasterVolume() + delta));
      mixer.ambientMixer.setMasterVolume(newVol);
      mixer.ui?.updateAmbientMasterVolume(newVol);
      const soundscapes = await Storage.getSoundscapes();
      const ss = soundscapes[mixer.currentSoundscape];
      if (ss) {
        if (!ss.ambientMaster) ss.ambientMaster = { volume: 1 };
        ss.ambientMaster.volume = newVol;
        await Storage.setSoundscapes(soundscapes);
      }
      return;
    }
    const m = entityKey.match(/^amb-(\d+)-volume$/);
    if (m) {
      const i = +m[1];
      const ch = mixer.ambientMixer?.channels[i];
      if (ch) {
        const newVol = Math.max(0, Math.min(1.25, ch.settings.volume + delta));
        ch.setVolume(newVol);
        mixer.ui?.updateAmbientChannelVolume(i, newVol);
        const soundscapes = await Storage.getSoundscapes();
        const ss = soundscapes[mixer.currentSoundscape];
        if (ss) {
          if (!ss.ambient) ss.ambient = [];
          if (!ss.ambient[i]) ss.ambient[i] = { settings: { volume: 1, name: '' }, soundData: null };
          ss.ambient[i].settings.volume = newVol;
          await Storage.setSoundscapes(soundscapes);
        }
      }
    }
  }

  async _executeVolumeAction(entityKey, volume) {
    const mixer = this.mixer;
    if (!mixer) return;
    volume = Math.max(0, Math.min(1.25, volume));

    if (entityKey === 'master-volume') {
      mixer.master.setVolume(volume);
      mixer.ui?.updateMasterVolume(volume);
      const soundscapes = await Storage.getSoundscapes();
      if (soundscapes[mixer.currentSoundscape]) {
        soundscapes[mixer.currentSoundscape].master.settings.volume = volume;
        await Storage.setSoundscapes(soundscapes);
      }
      return;
    }
    if (entityKey === 'amb-master-volume') {
      mixer.ambientMixer?.setMasterVolume(volume);
      mixer.ui?.updateAmbientMasterVolume(volume);
      const soundscapes = await Storage.getSoundscapes();
      const ss = soundscapes[mixer.currentSoundscape];
      if (ss) {
        if (!ss.ambientMaster) ss.ambientMaster = { volume: 1 };
        ss.ambientMaster.volume = volume;
        await Storage.setSoundscapes(soundscapes);
      }
      return;
    }
    let m = entityKey.match(/^ch-(\d+)-volume$/);
    if (m) {
      const i = +m[1], ch = mixer.channels[i];
      if (ch) {
        if (ch.getLink()) {
          await mixer.setLinkVolumes(volume, i);  // already saves to storage
          mixer.ui?.updateAllChannelVolumes();
        } else {
          ch.setVolume(volume);
          mixer.ui?.updateChannelVolume(i, volume);
          const soundscapes = await Storage.getSoundscapes();
          if (soundscapes[mixer.currentSoundscape]) {
            soundscapes[mixer.currentSoundscape].channels[i].settings.volume = volume;
            await Storage.setSoundscapes(soundscapes);
          }
        }
      }
      return;
    }
    m = entityKey.match(/^amb-(\d+)-volume$/);
    if (m) {
      const i = +m[1];
      const ch = mixer.ambientMixer?.channels[i];
      if (ch) {
        ch.setVolume(volume);
        mixer.ui?.updateAmbientChannelVolume(i, volume);
        const soundscapes = await Storage.getSoundscapes();
        const ss = soundscapes[mixer.currentSoundscape];
        if (ss) {
          if (!ss.ambient) ss.ambient = [];
          if (!ss.ambient[i]) ss.ambient[i] = { settings: { volume: 1, name: '' }, soundData: null };
          ss.ambient[i].settings.volume = volume;
          await Storage.setSoundscapes(soundscapes);
        }
      }
    }
  }

  _uiUpdate() {
    if (this.mixer?.onUIUpdate) this.mixer.onUIUpdate();
  }

  getDevices() { return this.devices; }
}
