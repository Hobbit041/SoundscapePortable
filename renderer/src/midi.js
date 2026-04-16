/**
 * midi.js — Web MIDI API integration for Soundscape.
 *
 * Default CC mapping:
 *   CC 0-7  → channel fader volume (ch 0–7)
 *   CC 8    → master volume
 *   CC 16-23 → mute toggle (ch 0–7)
 *   Note On 0-24 → soundboard button 0–24
 */
export class MidiController {
  constructor(mixer) {
    this.mixer   = mixer;
    this.enabled = false;
    this.devices = [];
    this.mapping = this._defaultMapping();
    this._access = null;
    this.onDevicesChanged = null; // set by UI
  }

  _defaultMapping() {
    const cc = {};
    for (let i = 0; i < 8; i++) cc[i] = { action: 'volume', channel: i };
    cc[8] = { action: 'volume', channel: 'master' };
    for (let i = 0; i < 8; i++) cc[16 + i] = { action: 'mute', channel: i };
    const notes = {};
    for (let i = 0; i < 25; i++) notes[i] = i;
    return { cc, notes };
  }

  async enable() {
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

  _onMessage(msg) {
    const [status, data1, data2] = msg.data;
    const type = status & 0xF0;
    if (type === 0xB0) this._handleCC(data1, data2);
    else if (type === 0x90 && data2 > 0) this._handleNoteOn(data1);
  }

  _handleCC(cc, value) {
    const map = this.mapping.cc[cc];
    if (!map) return;
    const normalized = value / 127;
    if (map.action === 'volume') {
      if (map.channel === 'master') this.mixer.master.setVolume(normalized);
      else {
        const ch = this.mixer.channels[map.channel];
        if (ch) ch.getLink()
          ? this.mixer.setLinkVolumes(normalized, map.channel)
          : ch.setVolume(normalized);
      }
      if (this.mixer.onUIUpdate) this.mixer.onUIUpdate();
    } else if (map.action === 'mute' && value > 63) {
      const ch = this.mixer.channels[map.channel];
      if (ch) { ch.setMute(!ch.getMute()); if (this.mixer.onUIUpdate) this.mixer.onUIUpdate(); }
    }
  }

  _handleNoteOn(note) {
    const sbIndex = this.mapping.notes[note];
    if (sbIndex == null) return;
    this.mixer.soundboard.playSound(sbIndex);
    if (this.mixer.onUIUpdate) this.mixer.onUIUpdate();
  }

  setCC(ccNumber, action, channel) { this.mapping.cc[ccNumber] = { action, channel }; }
  setNote(noteNumber, sbIndex) { this.mapping.notes[noteNumber] = sbIndex; }
  getDevices() { return this.devices; }
}
