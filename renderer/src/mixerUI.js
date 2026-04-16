/**
 * mixerUI.js
 * Replaces mixerApp.js — pure DOM manipulation, no Foundry/jQuery.
 * Handles all UI rendering and event binding.
 */
import { Storage }                from './storage.js';
import { FXDialog }               from './fxDialog.js';
import { ChannelConfigDialog }    from './channelConfigDialog.js';
import { SoundboardConfigDialog } from './soundboardConfigDialog.js';

export class MixerUI {
  constructor(mixer) {
    this.mixer = mixer;
    this._dragSource = null;
    this._controlDown = false;
    this._bindStaticEvents();
  }

  // ─── Full render ─────────────────────────────────────────────────────────────

  async render() {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.mixer.currentSoundscape] ?? {};
    const total = soundscapes.length;

    // Header
    this._el('soundscapeName').value  = this.mixer.name ?? '';
    this._el('soundscapeNumber').textContent = `${this.mixer.currentSoundscape + 1} / ${total}`;

    // Play button
    this._el('playMix').innerHTML = this.mixer.playing
      ? '<i class="fas fa-stop"></i>'
      : '<i class="fas fa-play"></i>';

    // Master
    const masterVol = ss.master?.settings?.volume ?? 1;
    this._el('volumeSlider-master').value  = masterVol * 100;
    this._el('volumeNumber-master').value  = Math.round(masterVol * 100);
    this._setMuteColor('mute-master', ss.master?.settings?.mute ?? false);

    // Channels
    for (let i = 0; i < 8; i++) {
      const ch   = this.mixer.channels[i];
      const data = ss.channels?.[i];
      if (!data) continue;

      this._el(`channelName-${i}`).value      = data.settings?.name ?? '';
      this._el(`volumeSlider-${i}`).value     = (data.settings?.volume ?? 1) * 100;
      this._el(`volumeNumber-${i}`).value     = Math.round((data.settings?.volume ?? 1) * 100);
      this._el(`panSlider-${i}`).value        = (data.settings?.pan ?? 0) * 25;
      this._setMuteColor(`mute-${i}`, data.settings?.mute ?? false);
      this._setSoloColor(`solo-${i}`, data.settings?.solo ?? false);
      this._setLinkColor(`link-${i}`, data.settings?.link ?? false);
      this._el(`playSound-${i}`).innerHTML = ch.playing
        ? '<i class="fas fa-stop"></i>'
        : '<i class="fas fa-play"></i>';
    }

    // Soundboard
    const sbData = ss.soundboard ?? [];
    const sbGain = ss.soundboardGain ?? 0.5;
    this._el('sbVolume').value = sbGain * 100;

    for (let i = 0; i < 25; i++) {
      const btn = this._el(`sbButton-${i}`);
      if (!btn) continue;
      const d = sbData[i] ?? {};
      const rpt = d.repeat?.repeat ?? d.repeat ?? 'none';
      const isLoop = rpt === 'single' || rpt === 'all';
      btn.style.borderColor = isLoop ? 'yellow' : '';
      btn.style.boxShadow   = isLoop ? '0 0 8px yellow' : '';

      const label = this._el(`sbLabel-${i}`);
      if (label) label.textContent = d.name ?? '';

      // Image
      const img = this._el(`sbImg-${i}`);
      if (img) img.src = d.imageSrc || '';
    }
  }

  updatePlayState() {
    const playing = this.mixer.playing;
    this._el('playMix').innerHTML = playing
      ? '<i class="fas fa-stop"></i>'
      : '<i class="fas fa-play"></i>';
    for (let i = 0; i < 8; i++) {
      const btn = this._el(`playSound-${i}`);
      if (btn) btn.innerHTML = this.mixer.channels[i].playing
        ? '<i class="fas fa-stop"></i>'
        : '<i class="fas fa-play"></i>';
    }
  }

  updateChannelVolume(channelNr, volume) {
    const sl = this._el(`volumeSlider-${channelNr}`);
    const nb = this._el(`volumeNumber-${channelNr}`);
    if (sl) sl.value = volume * 100;
    if (nb) nb.value = Math.round(volume * 100);
  }

  updateMasterVolume(volume) {
    const sl = this._el('volumeSlider-master');
    const nb = this._el('volumeNumber-master');
    if (sl) sl.value = volume * 100;
    if (nb) nb.value = Math.round(volume * 100);
  }

  updateSoundboardVolume(volume) {
    const el = this._el('sbVolume');
    if (el) el.value = volume * 100;
  }

  updateMute(channelNr, mute) {
    this._setMuteColor(`mute-${channelNr}`, mute);
  }

  flashSoundboardButton(index) {
    const btn = this._el(`sbButton-${index}`);
    if (!btn) return;
    btn.classList.add('sb-flash');
    setTimeout(() => btn.classList.remove('sb-flash'), 200);
  }

  updateMIDIStatus(devices) {
    const el = this._el('midiStatus');
    if (!el) return;
    el.textContent = devices.length > 0
      ? `MIDI: ${devices.join(', ')}`
      : 'MIDI: no devices';
  }

  // ─── Static event binding (called once) ──────────────────────────────────────

  _bindStaticEvents() {
    document.addEventListener('keydown', e => { if (e.key === 'Control' || e.key === 'Meta') this._controlDown = true; });
    document.addEventListener('keyup',   e => { if (e.key === 'Control' || e.key === 'Meta') this._controlDown = false; });

    // ── Navigation ──
    this._on('prevSoundscape', 'click', () => this._navigate(-1));
    this._on('nextSoundscape', 'click', () => this._navigate(1));
    this._on('addSoundscape',  'click', () => this._addSoundscape());
    this._on('delSoundscape',  'click', () => this._removeSoundscape());

    // ── Soundscape name ──
    this._on('soundscapeName', 'change', async (e) => {
      await this.mixer.renameSoundscape(this.mixer.currentSoundscape, e.target.value);
    });

    // ── Global play/stop ──
    this._on('playMix', 'click', () => {
      if (this.mixer.playing) this.mixer.stop();
      else this.mixer.start();
    });

    // ── Master volume ──
    this._on('volumeSlider-master', 'input', async (e) => {
      const val = e.target.value / 100;
      this._el('volumeNumber-master').value = Math.round(val * 100);
      this.mixer.master.setVolume(val);
      await this._saveMasterVolume(val);
    });
    this._on('volumeNumber-master', 'change', async (e) => {
      const val = e.target.value / 100;
      this._el('volumeSlider-master').value = val * 100;
      this.mixer.master.setVolume(val);
      await this._saveMasterVolume(val);
    });
    this._on('mute-master', 'click', async () => {
      const mute = !this.mixer.master.getMute();
      this.mixer.master.setMute(mute);
      this._setMuteColor('mute-master', mute);
      await this._saveMasterMute(mute);
    });

    // ── Global volume (interface gain) ──
    this._on('globalVolume', 'input', async (e) => {
      const val = e.target.value / 100;
      this.mixer.master.effects.interfaceGain.set(val);
      await window.api.store.set('volume', val);
    });

    // ── Soundboard volume & stop ──
    this._on('sbVolume', 'input', async (e) => {
      await this.mixer.soundboard.setVolume(e.target.value / 100);
    });
    this._on('sbStopAll', 'click', () => {
      this.mixer.soundboard.stopAll();
    });

    // ── Import / Export ──
    this._on('btnExport', 'click', () => this._exportData());
    this._on('btnImport', 'click', () => this._importData());

    // ── Per-channel events (delegated) ──
    for (let i = 0; i < 8; i++) {
      this._bindChannelEvents(i);
    }

    // ── Soundboard buttons ──
    for (let i = 0; i < 25; i++) {
      this._bindSoundboardButton(i);
    }
  }

  _bindChannelEvents(i) {
    // Volume slider
    this._on(`volumeSlider-${i}`, 'input', async (e) => {
      const val = e.target.value / 100;
      this._el(`volumeNumber-${i}`).value = Math.round(val * 100);
      if (this.mixer.channels[i].getLink()) await this.mixer.setLinkVolumes(val, i);
      else this.mixer.channels[i].setVolume(val);
      await this._saveChannelVolume(i, val);
    });
    this._on(`volumeNumber-${i}`, 'change', async (e) => {
      const val = e.target.value / 100;
      this._el(`volumeSlider-${i}`).value = val * 100;
      if (this.mixer.channels[i].getLink()) await this.mixer.setLinkVolumes(val, i);
      else this.mixer.channels[i].setVolume(val);
      await this._saveChannelVolume(i, val);
    });

    // Mute
    this._on(`mute-${i}`, 'click', async () => {
      const mute = !this.mixer.channels[i].getMute();
      this.mixer.channels[i].setMute(mute);
      this._setMuteColor(`mute-${i}`, mute);
      await this._saveChannelSetting(i, 'mute', mute);
    });

    // Solo
    this._on(`solo-${i}`, 'click', async () => {
      const solo = !this.mixer.channels[i].getSolo();
      this.mixer.channels[i].setSolo(solo);
      this.mixer.configureSolo();
      this._setSoloColor(`solo-${i}`, solo);
      await this._saveChannelSetting(i, 'solo', solo);
    });

    // Link
    this._on(`link-${i}`, 'click', async () => {
      const link = !this.mixer.channels[i].getLink();
      this.mixer.channels[i].setLink(link);
      this.mixer.configureLink();
      this._setLinkColor(`link-${i}`, link);
      await this._saveChannelSetting(i, 'link', link);
    });

    // Pan
    this._on(`panSlider-${i}`, 'input', async (e) => {
      const val = e.target.value / 25;
      this.mixer.channels[i].setPan(val);
      await this._saveChannelSetting(i, 'pan', val);
    });

    // Play/stop individual channel
    this._on(`playSound-${i}`, 'click', () => {
      const ch = this.mixer.channels[i];
      if (ch.playing) this.mixer.stop(i);
      else            this.mixer.start(i);
      // icon is updated by channel.play() / channel.stop() directly
    });

    // Prev / Next track
    this._on(`prevTrack-${i}`, 'click', () => this.mixer.channels[i].previous());
    this._on(`nextTrack-${i}`, 'click', () => this.mixer.channels[i].next());

    // Config dialog (repeat / timing / playback rate / source)
    this._on(`config-${i}`, 'click', () => {
      new ChannelConfigDialog(this.mixer.channels[i], this.mixer, i).open();
    });

    // FX panel (EQ + Delay)
    this._on(`fx-${i}`, 'click', () => {
      new FXDialog(this.mixer.channels[i], this.mixer).open();
    });

    // Channel name
    this._on(`channelName-${i}`, 'change', async (e) => {
      await this._saveChannelSetting(i, 'name', e.target.value);
    });

    // Drag-and-drop from OS (channel box)
    const box = this._el(`box-${i}`);
    if (box) {
      box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('drag-over'); });
      box.addEventListener('dragleave', () => box.classList.remove('drag-over'));
      box.addEventListener('drop', async (e) => {
        e.preventDefault();
        box.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (!file) return;
        const name = file.name.replace(/\.[^.]+$/, '');
        // In Electron, file.path gives the real disk path
        await this.mixer.newData(i, { type: 'filepicker_single', source: file.path, name });
      });
    }
  }

  _bindSoundboardButton(i) {
    const btn = this._el(`sbButton-${i}`);
    if (!btn) return;

    // Left click = play
    btn.addEventListener('click', (e) => {
      if (e.target.classList.contains('sbConfig')) return;
      this.mixer.soundboard.playSound(i);
      this.flashSoundboardButton(i);
    });

    // Right click = open config dialog
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      new SoundboardConfigDialog(this.mixer.soundboard, this.mixer, i).open();
    });

    // Drag-and-drop
    btn.addEventListener('dragover', e => { e.preventDefault(); btn.classList.add('drag-over'); });
    btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
    btn.addEventListener('drop', async (e) => {
      e.preventDefault();
      btn.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const name = file.name.replace(/\.[^.]+$/, '');
      await this.mixer.soundboard.newData(i, { type: 'filepicker_single', source: file.path, name });
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  _el(id) { return document.getElementById(id); }

  _on(id, event, handler) {
    const el = this._el(id);
    if (el) el.addEventListener(event, handler);
  }

  _setMuteColor(id, mute) {
    const el = this._el(id);
    if (el) el.style.backgroundColor = mute ? '#ff0000' : '#7f0000';
  }

  _setSoloColor(id, solo) {
    const el = this._el(id);
    if (el) el.style.backgroundColor = solo ? '#ffff00' : '#7f7f00';
  }

  _setLinkColor(id, link) {
    const el = this._el(id);
    if (el) el.style.backgroundColor = link ? '#0096ff' : '#000fff';
  }

  async _navigate(direction) {
    const soundscapes = await Storage.getSoundscapes();
    let next = this.mixer.currentSoundscape + direction;
    if (next < 0) next = soundscapes.length - 1;
    if (next >= soundscapes.length) next = 0;
    await this.mixer.setSoundscape(next);
  }

  async _addSoundscape() {
    const soundscapes = await Storage.getSoundscapes();
    await this.mixer.insertSoundscape(soundscapes.length);
    await this.mixer.setSoundscape(soundscapes.length);
  }

  async _removeSoundscape() {
    if (!confirm('Remove this soundscape?')) return;
    await this.mixer.removeSoundscape(this.mixer.currentSoundscape);
  }

  async _saveChannelVolume(i, val) {
    const soundscapes = await Storage.getSoundscapes();
    if (soundscapes[this.mixer.currentSoundscape]) {
      soundscapes[this.mixer.currentSoundscape].channels[i].settings.volume = val;
      await Storage.setSoundscapes(soundscapes);
    }
  }

  async _saveChannelSetting(i, key, val) {
    const soundscapes = await Storage.getSoundscapes();
    if (soundscapes[this.mixer.currentSoundscape]) {
      soundscapes[this.mixer.currentSoundscape].channels[i].settings[key] = val;
      await Storage.setSoundscapes(soundscapes);
    }
  }

  async _saveMasterVolume(val) {
    const soundscapes = await Storage.getSoundscapes();
    if (soundscapes[this.mixer.currentSoundscape]) {
      soundscapes[this.mixer.currentSoundscape].master.settings.volume = val;
      await Storage.setSoundscapes(soundscapes);
    }
  }

  async _saveMasterMute(mute) {
    const soundscapes = await Storage.getSoundscapes();
    if (soundscapes[this.mixer.currentSoundscape]) {
      soundscapes[this.mixer.currentSoundscape].master.settings.mute = mute;
      await Storage.setSoundscapes(soundscapes);
    }
  }

  async _exportData() {
    const soundscapes = await Storage.getSoundscapes();
    await window.api.data.save(soundscapes);
  }

  async _importData() {
    const data = await window.api.data.load();
    if (!data) return;
    const existing = await Storage.getSoundscapes();
    await Storage.setSoundscapes(existing.concat(data));
    await this.mixer.setSoundscape(this.mixer.currentSoundscape);
  }
}
