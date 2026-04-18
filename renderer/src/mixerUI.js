/**
 * mixerUI.js
 * Replaces mixerApp.js — pure DOM manipulation, no Foundry/jQuery.
 * Handles all UI rendering and event binding.
 */
import { Storage }                from './storage.js';
import { FXDialog }               from './fxDialog.js';
import { ChannelConfigDialog }    from './channelConfigDialog.js';
import { SoundboardConfigDialog } from './soundboardConfigDialog.js';
import { filesToPlaylistItems, PlaylistDialog } from './playlistDialog.js';
import { AMBIENT_SIZE }           from './ambientMixer.js';

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif']);

/** Convert a local file path to a file:// URL for use in <img src>. */
function _fileUrl(p) {
  if (!p) return '';
  if (/^(https?:|file:|blob:)/i.test(p)) return p;
  return 'file:///' + p.replace(/\\/g, '/');
}

// ── MIDI entity table ────────────────────────────────────────────────────────
const MIDI_ENTITIES = [
  ...Array.from({ length: 8 }, (_, i) => [
    { key: `ch-${i}-mute`,   targetId: `mute-${i}`,         type: 'noteon',    insertInside: true },
    { key: `ch-${i}-solo`,   targetId: `solo-${i}`,         type: 'noteon',    insertInside: true },
    { key: `ch-${i}-volume`, targetId: `volumeSlider-${i}`, type: 'pitchbend' },
    { key: `ch-${i}-play`,   targetId: `playSound-${i}`,    type: 'noteon'    },
    { key: `ch-${i}-prev`,   targetId: `prevTrack-${i}`,    type: 'noteon',    insertInside: true },
    { key: `ch-${i}-next`,   targetId: `nextTrack-${i}`,    type: 'noteon',    insertInside: true },
  ]).flat(),
  { key: 'master-volume', targetId: 'volumeSlider-master', type: 'pitchbend' },
  { key: 'master-play',   targetId: 'playMix',             type: 'noteon'    },
  { key: 'sb-stopall',    targetId: 'sbStopAll',           type: 'noteon'    },
  ...Array.from({ length: 25 }, (_, i) => ({
    key: `sb-${i}`, targetId: `sbButton-${i}`, type: 'noteon', insertInside: true
  })),
  ...Array.from({ length: AMBIENT_SIZE }, (_, i) => ({
    key: `amb-${i}-volume`, targetId: `ambSlider-${i}`, type: 'volume_any'
  })),
  { key: 'amb-master-volume', targetId: 'ambSlider-master', type: 'volume_any' },
];

function _fmtMapping(m) {
  if (!m) return '';
  if (m.type === 'noteon')      return `Note ${m.note} Ch${m.channel + 1}`;
  if (m.type === 'pitchbend')   return `PitchBend Ch${m.channel + 1}`;
  if (m.type === 'cc_relative') return `CC${m.cc} Ch${m.channel + 1}`;
  return '';
}
// ────────────────────────────────────────────────────────────────────────────

export class MixerUI {
  constructor(mixer) {
    this.mixer        = mixer;
    this.midi         = null;   // set by app.js after midi init
    this._dragSource  = null;
    this._controlDown = false;
    this._mappingMode = false;
    this._bindStaticEvents();
  }

  // ─── Full render ─────────────────────────────────────────────────────────────

  async render() {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.mixer.currentSoundscape] ?? {};

    // Header
    this._el('soundscapeName').value  = this.mixer.name ?? '';
    // Update profile list if open
    await this._refreshSoundscapeList();

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
      this._setMuteColor(`mute-${i}`, data.settings?.mute ?? false);
      this._setSoloColor(`solo-${i}`, data.settings?.solo ?? false);
      this._setLinkColor(`link-${i}`, data.settings?.link ?? false);
      this._el(`playSound-${i}`).innerHTML = ch.playing
        ? '<i class="fas fa-stop"></i>'
        : '<i class="fas fa-play"></i>';
    }

    // Scenes
    this._renderScenes(ss);

    // Ambient mixer
    const ambData      = ss.ambient ?? [];
    const ambMasterVol = ss.ambientMaster?.volume ?? 1;
    const ambSlMaster  = this._el('ambSlider-master');
    if (ambSlMaster) ambSlMaster.value = ambMasterVol * 100;
    for (let i = 0; i < AMBIENT_SIZE; i++) {
      const amb = ambData[i] ?? {};
      const nameEl = this._el(`ambName-${i}`);
      const slEl   = this._el(`ambSlider-${i}`);
      const playEl = this._el(`ambPlay-${i}`);
      if (nameEl) nameEl.value   = amb.settings?.name ?? '';
      if (slEl)   slEl.value     = (amb.settings?.volume ?? 1) * 100;
      if (playEl) playEl.innerHTML = this.mixer.ambientMixer?.channels[i]?.playing
        ? '<i class="fas fa-stop"></i>'
        : '<i class="fas fa-play"></i>';
    }

    // Soundboard scenes
    this._renderSbScenes(ss);

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
      if (img) img.src = _fileUrl(d.imageSrc);
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

  /** Update all channel + master volume sliders from live channel state (used by MIDI). */
  updateAllChannelVolumes() {
    for (let i = 0; i < 8; i++) {
      const vol = this.mixer.channels[i].settings.volume ?? 1;
      const sl = this._el(`volumeSlider-${i}`);
      const nb = this._el(`volumeNumber-${i}`);
      if (sl) sl.value = vol * 100;
      if (nb) nb.value = Math.round(vol * 100);
    }
  }

  updateAmbientChannelVolume(i, volume) {
    const sl = this._el(`ambSlider-${i}`);
    if (sl) sl.value = volume * 100;
  }

  updateAmbientMasterVolume(volume) {
    const sl = this._el('ambSlider-master');
    if (sl) sl.value = volume * 100;
  }

  updateMute(channelNr, mute) {
    this._setMuteColor(`mute-${channelNr}`, mute);
  }

  updateSolo(channelNr, solo) {
    this._setSoloColor(`solo-${channelNr}`, solo);
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
    document.addEventListener('keydown', e => {
      if (e.key === 'Control' || e.key === 'Meta') this._controlDown = true;
      if (e.key === 'F2') { e.preventDefault(); this._exportMidiMappings(); }
      if (e.key === 'F3') { e.preventDefault(); this._importMidiMappings(); }
    });
    document.addEventListener('keyup',   e => { if (e.key === 'Control' || e.key === 'Meta') this._controlDown = false; });

    // ── MIDI mapping mode ──
    this._on('midiStatus', 'click', () => this._toggleMappingMode());

    // ── Profile list ──
    this._on('soundscapeList', 'click', () => this._openSoundscapeList());

    // ── Soundscape name ──
    this._on('soundscapeName', 'change', async (e) => {
      await this.mixer.renameSoundscape(this.mixer.currentSoundscape, e.target.value);
    });

    // ── Global play/stop ──
    this._on('playMix', 'click', () => {
      if (this.mixer.playing) this.mixer.stop();
      else this.mixer.start();
      this.updatePlayState();
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

    // ── Ambient channels ──
    for (let i = 0; i < AMBIENT_SIZE; i++) {
      this._bindAmbientChannel(i);
    }

    // ── Ambient master fader ──
    this._on('ambSlider-master', 'input', async (e) => {
      const val = e.target.value / 100;
      this.mixer.ambientMixer?.setMasterVolume(val);
      await this._saveAmbientMasterVolume(val);
    });

    // ── Add scene ──
    this._on('addScene', 'click', () => this.mixer.addScene());

    // ── Add soundboard scene ──
    this._on('addSbScene', 'click', () => this.mixer.addSoundboardScene());
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
    this._on(`solo-${i}`, 'click', () => { this.mixer.toggleSolo(i); });

    // Link
    this._on(`link-${i}`, 'click', async () => {
      const link = !this.mixer.channels[i].getLink();
      this.mixer.channels[i].setLink(link);
      this.mixer.configureLink();
      this._setLinkColor(`link-${i}`, link);
      await this._saveChannelSetting(i, 'link', link);
    });

    // Play/stop individual channel
    this._on(`playSound-${i}`, 'click', () => {
      const ch = this.mixer.channels[i];
      if (ch.playing) this.mixer.stop(i);
      else            this.mixer.start(i);
      this.updatePlayState();
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
        const files = Array.from(e.dataTransfer.files);
        if (!files.length) return;
        const playlist = await filesToPlaylistItems(files);
        const name = playlist[0]?.label?.replace(/\.[^.]+$/, '') ?? '';
        await this.mixer.newData(i, { type: 'playlist', playlist, name });
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
      const files = Array.from(e.dataTransfer.files);
      if (!files.length) return;

      const firstPath = files[0].path;
      const ext = (firstPath ?? files[0].name).split('.').pop().toLowerCase();

      if (IMAGE_EXT.has(ext)) {
        // Set as button icon
        await this.mixer.soundboard.newData(i, { type: 'image', source: firstPath });
        const img = this._el(`sbImg-${i}`);
        if (img) img.src = _fileUrl(firstPath);
      } else {
        const playlist = await filesToPlaylistItems(files);
        if (!playlist.length) return;
        const name = playlist[0]?.label?.replace(/\.[^.]+$/, '') ?? '';
        await this.mixer.soundboard.newData(i, { type: 'playlist', playlist, name });
      }
    });
  }

  _bindAmbientChannel(i) {
    // Volume fader
    this._on(`ambSlider-${i}`, 'input', async (e) => {
      const val = e.target.value / 100;
      this.mixer.ambientMixer?.channels[i].setVolume(val);
      await this._saveAmbientVolume(i, val);
    });

    // Play/stop toggle
    this._on(`ambPlay-${i}`, 'click', () => {
      const ch = this.mixer.ambientMixer?.channels[i];
      if (!ch) return;
      if (ch.playing) ch.stop();
      else            ch.play();
      const btn = this._el(`ambPlay-${i}`);
      if (btn) btn.innerHTML = ch.playing
        ? '<i class="fas fa-stop"></i>'
        : '<i class="fas fa-play"></i>';
    });

    // Config button → open playlist dialog
    this._on(`ambConfig-${i}`, 'click', () => this._openAmbientPlaylist(i));

    // Name input
    this._on(`ambName-${i}`, 'change', async (e) => {
      await this._saveAmbientSetting(i, 'name', e.target.value);
      const ch = this.mixer.ambientMixer?.channels[i];
      if (ch) ch.settings.name = e.target.value;
    });

    // Drag-and-drop + right-click
    const box = this._el(`ambBox-${i}`);
    if (box) {
      box.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._openAmbientPlaylist(i);
      });

      box.addEventListener('dragover',  e => { e.preventDefault(); box.classList.add('drag-over'); });
      box.addEventListener('dragleave', () => box.classList.remove('drag-over'));
      box.addEventListener('drop', async (e) => {
        e.preventDefault();
        box.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files);
        if (!files.length) return;
        const playlist = await filesToPlaylistItems(files);
        if (!playlist.length) return;
        const ss = await Storage.getSoundscapes();
        if (!ss[this.mixer.currentSoundscape]) return;
        if (!ss[this.mixer.currentSoundscape].ambient)
          ss[this.mixer.currentSoundscape].ambient = [];
        if (!ss[this.mixer.currentSoundscape].ambient[i])
          ss[this.mixer.currentSoundscape].ambient[i] =
            { settings: { volume: 1, name: '' }, soundData: {} };

        const ambEntry = ss[this.mixer.currentSoundscape].ambient[i];
        ambEntry.soundData = { playlist, shuffle: false };

        // Set name from first file if channel has no name yet
        const newName = playlist[0]?.label?.replace(/\.[^.]+$/, '') ?? '';
        if (!ambEntry.settings.name && newName) {
          ambEntry.settings.name = newName;
        }

        await Storage.setSoundscapes(ss);

        const ch = this.mixer.ambientMixer?.channels[i];
        if (ch) {
          const urls = await Promise.all(playlist.map(item => window.api.fs.toUrl(item.path)));
          ch.sourceArray = urls.filter(Boolean);
          ch.settings.name = ambEntry.settings.name;
        }

        // Update name input in DOM
        const nameEl = this._el(`ambName-${i}`);
        if (nameEl) nameEl.value = ambEntry.settings.name;

        // Restore slider value — Chromium may alter range inputs during OS drag-and-drop
        const slEl = this._el(`ambSlider-${i}`);
        if (slEl) slEl.value = (ambEntry.settings.volume ?? 1) * 100;
      });
    }
  }

  _openAmbientPlaylist(i) {
    new PlaylistDialog({
      title:         `Ambient ${i + 1}`,
      panelId:       `amb-${i}`,
      getSoundData:  async () => {
        const ss = await Storage.getSoundscapes();
        return ss[this.mixer.currentSoundscape]?.ambient?.[i]?.soundData;
      },
      saveSoundData: async (data) => {
        const ss = await Storage.getSoundscapes();
        if (ss[this.mixer.currentSoundscape]) {
          if (!ss[this.mixer.currentSoundscape].ambient)
            ss[this.mixer.currentSoundscape].ambient = [];
          if (!ss[this.mixer.currentSoundscape].ambient[i])
            ss[this.mixer.currentSoundscape].ambient[i] =
              { settings: { volume: 1, name: '' }, soundData: {} };
          ss[this.mixer.currentSoundscape].ambient[i].soundData = data;
          await Storage.setSoundscapes(ss);
        }
      },
      getChannel: () => this.mixer.ambientMixer?.channels[i],
      mode:       'ambient',
      onClear:    async () => { await this.mixer.clearAmbientChannel(i); }
    }).open();
  }

  // ─── Scenes ──────────────────────────────────────────────────────────────────

  _renderScenes(ss) {
    const scenes       = ss.scenes ?? [];
    const currentScene = ss.currentScene ?? 0;
    const addBtn       = this._el('addScene');
    if (!addBtn) return;

    const row = addBtn.parentElement;

    // Remove existing scene buttons / edit wraps
    row.querySelectorAll('.scene-btn, .scene-edit-wrap').forEach(el => el.remove());

    // Add scene buttons before the + button
    scenes.forEach((scene, idx) => {
      const btn = document.createElement('button');
      btn.className = 'scene-btn' + (idx === currentScene ? ' scene-active' : '');
      btn.dataset.sceneIdx = idx;
      btn.textContent = scene.name || `Scene ${idx + 1}`;

      btn.addEventListener('click', () => {
        const curIdx = this._currentSceneFromRow() ?? currentScene;
        if (idx === curIdx) return;
        // Visual transition: fade out current, illuminate target
        document.querySelector('.scene-btn.scene-active')?.classList.add('scene-fading-out');
        btn.classList.add('scene-pending-active');
        this.mixer.switchScene(idx);
      });

      btn.addEventListener('contextmenu', e => {
        e.preventDefault();
        this._editScene(btn, idx, scene.name || `Scene ${idx + 1}`, scenes.length);
      });

      row.insertBefore(btn, addBtn);
    });

    // Hide + button when at max
    addBtn.style.display = scenes.length >= 16 ? 'none' : '';

    // Re-inject scene MIDI controls if mapping mode is active
    if (this._mappingMode) this._injectSceneMappingControls();
  }

  _currentSceneFromRow() {
    const active = document.querySelector('.scene-btn.scene-active');
    return active ? parseInt(active.dataset.sceneIdx) : null;
  }

  _editScene(btn, idx, currentName, sceneCount) {
    const wrap = document.createElement('span');
    wrap.className = 'scene-edit-wrap';

    const input = document.createElement('input');
    input.className  = 'scene-name-input';
    input.type       = 'text';
    input.value      = currentName;
    input.spellcheck = false;

    const trash = document.createElement('button');
    trash.className = 'scene-trash-btn';
    trash.title     = 'Удалить сцену';
    trash.textContent = '🗑';
    trash.disabled  = sceneCount <= 1;

    wrap.appendChild(input);
    wrap.appendChild(trash);
    btn.replaceWith(wrap);
    input.focus();
    input.select();

    let trashClicked = false;

    trash.addEventListener('mousedown', () => { trashClicked = true; });

    trash.addEventListener('click', async () => {
      await this.mixer.removeScene(idx);
      // render() is called by removeScene → renderUI()
    });

    const finishEdit = async () => {
      if (trashClicked) return;
      const newName = input.value.trim() || `Scene ${idx + 1}`;
      await this.mixer.renameScene(idx, newName);
      // Re-render scenes only
      const soundscapes = await Storage.getSoundscapes();
      this._renderScenes(soundscapes[this.mixer.currentSoundscape]);
    };

    input.addEventListener('blur', finishEdit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { input.blur(); }
      if (e.key === 'Escape') { input.value = currentName; trashClicked = true; input.blur(); }
    });
  }

  // ─── Soundboard Scenes ───────────────────────────────────────────────────────

  _renderSbScenes(ss) {
    const sbScenes       = ss.sbScenes ?? [];
    const currentSbScene = ss.currentSbScene ?? 0;
    const addBtn         = this._el('addSbScene');
    if (!addBtn) return;

    const row = addBtn.parentElement;
    row.querySelectorAll('.sb-scene-btn, .sb-scene-edit-wrap').forEach(el => el.remove());

    sbScenes.forEach((scene, idx) => {
      const btn = document.createElement('button');
      btn.className = 'sb-scene-btn' + (idx === currentSbScene ? ' sb-scene-active' : '');
      btn.dataset.sbSceneIdx = idx;
      btn.textContent = scene.name || `SB ${idx + 1}`;

      btn.addEventListener('click', () => {
        this.mixer.switchSoundboardScene(idx);
      });

      btn.addEventListener('contextmenu', e => {
        e.preventDefault();
        this._editSbScene(btn, idx, scene.name || `SB ${idx + 1}`, sbScenes.length);
      });

      row.insertBefore(btn, addBtn);
    });

    addBtn.style.display = sbScenes.length >= 16 ? 'none' : '';
  }

  _editSbScene(btn, idx, currentName, sceneCount) {
    const wrap = document.createElement('span');
    wrap.className = 'sb-scene-edit-wrap scene-edit-wrap';

    const input = document.createElement('input');
    input.className  = 'scene-name-input';
    input.type       = 'text';
    input.value      = currentName;
    input.spellcheck = false;

    const trash = document.createElement('button');
    trash.className = 'scene-trash-btn';
    trash.title     = 'Удалить сцену саундборда';
    trash.textContent = '🗑';
    trash.disabled  = sceneCount <= 1;

    wrap.appendChild(input);
    wrap.appendChild(trash);
    btn.replaceWith(wrap);
    input.focus();
    input.select();

    let trashClicked = false;

    trash.addEventListener('mousedown', () => { trashClicked = true; });

    trash.addEventListener('click', async () => {
      await this.mixer.removeSoundboardScene(idx);
    });

    const finishEdit = async () => {
      if (trashClicked) return;
      const newName = input.value.trim() || `SB ${idx + 1}`;
      await this.mixer.renameSoundboardScene(idx, newName);
      const soundscapes = await Storage.getSoundscapes();
      this._renderSbScenes(soundscapes[this.mixer.currentSoundscape]);
    };

    input.addEventListener('blur', finishEdit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { input.blur(); }
      if (e.key === 'Escape') { input.value = currentName; trashClicked = true; input.blur(); }
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

  // ─── Profile list panel ──────────────────────────────────────────────────────

  _openSoundscapeList() {
    const existing = document.getElementById('ssListPanel');
    if (existing) { existing.remove(); return; }
    this._renderSoundscapeListPanel();
  }

  async _renderSoundscapeListPanel() {
    const soundscapes = await Storage.getSoundscapes();
    const current = this.mixer.currentSoundscape;

    const panel = document.createElement('div');
    panel.id        = 'ssListPanel';
    panel.className = 'ss-list-panel';

    // Position below the trigger button
    const btn = document.getElementById('soundscapeList');
    if (btn) {
      const rect = btn.getBoundingClientRect();
      panel.style.top  = `${rect.bottom + 4}px`;
      panel.style.left = `${Math.max(4, rect.right - 220)}px`;
    }

    const scroll = document.createElement('div');
    scroll.className = 'ss-list-scroll';
    scroll.id        = 'ssListScroll';

    soundscapes.forEach((ss, idx) => {
      scroll.appendChild(this._makeSsRow(ss, idx, current));
    });

    const footer = document.createElement('div');
    footer.className = 'ss-list-footer';
    footer.innerHTML = `
      <button id="ssListAdd" title="Добавить профиль"><i class="fas fa-plus"></i></button>
      <button id="ssListDel" title="Удалить профиль" class="btn-danger"><i class="fas fa-trash"></i></button>
    `;

    panel.appendChild(scroll);
    panel.appendChild(footer);
    document.body.appendChild(panel);

    document.getElementById('ssListAdd')?.addEventListener('click', async () => {
      const list = await Storage.getSoundscapes();
      const newIdx = list.length;
      await this.mixer.insertSoundscape(newIdx);
      await this.mixer.renameSoundscape(newIdx, 'Профиль');
      await this._refreshSoundscapeList();
    });

    document.getElementById('ssListDel')?.addEventListener('click', async () => {
      if (!confirm('Удалить текущий профиль?')) return;
      document.getElementById('ssListPanel')?.remove();
      this._ssOutsideOff?.();
      await this.mixer.removeSoundscape(this.mixer.currentSoundscape);
    });

    // Close on outside click
    const onOutside = (e) => {
      const p = document.getElementById('ssListPanel');
      const b = document.getElementById('soundscapeList');
      if (p && !p.contains(e.target) && !b?.contains(e.target)) {
        p.remove();
        document.removeEventListener('mousedown', onOutside);
        this._ssOutsideOff = null;
      }
    };
    this._ssOutsideOff = () => {
      document.removeEventListener('mousedown', onOutside);
      this._ssOutsideOff = null;
    };
    setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
  }

  _makeSsRow(ss, idx, current) {
    const row = document.createElement('div');
    row.className   = 'ss-row' + (idx === current ? ' ss-row-active' : '');
    row.dataset.idx = String(idx);
    row.draggable   = true;
    row.textContent = ss.name || `Профиль ${idx + 1}`;

    // Track drag start to suppress click-on-drag-end
    let wasDragged = false;

    row.addEventListener('click', async () => {
      if (wasDragged) { wasDragged = false; return; }
      document.getElementById('ssListPanel')?.remove();
      this._ssOutsideOff?.();
      if (idx !== this.mixer.currentSoundscape) {
        await this.mixer.setSoundscape(idx);
      }
    });

    row.addEventListener('dragstart', e => {
      wasDragged = true;
      this._ssDragSrc = idx;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
      row.classList.add('ss-row-dragging');
    });

    row.addEventListener('dragend', () => {
      this._ssDragSrc = null;
      document.querySelectorAll('.ss-row-above, .ss-row-below, .ss-row-dragging')
        .forEach(el => el.classList.remove('ss-row-above', 'ss-row-below', 'ss-row-dragging'));
      // Reset flag after a tick so click handler (which fires before dragend in some browsers) sees it
      setTimeout(() => { wasDragged = false; }, 0);
    });

    row.addEventListener('dragover', e => {
      if (this._ssDragSrc === null || this._ssDragSrc === idx) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      const upper = e.clientY < rect.top + rect.height / 2;
      document.querySelectorAll('.ss-row-above, .ss-row-below')
        .forEach(el => el.classList.remove('ss-row-above', 'ss-row-below'));
      row.classList.add(upper ? 'ss-row-above' : 'ss-row-below');
    });

    row.addEventListener('dragleave', e => {
      if (!row.contains(e.relatedTarget)) {
        row.classList.remove('ss-row-above', 'ss-row-below');
      }
    });

    row.addEventListener('drop', async e => {
      e.preventDefault();
      const from = this._ssDragSrc;
      if (from === null || from === idx) return;
      const rect    = row.getBoundingClientRect();
      const upper   = e.clientY < rect.top + rect.height / 2;
      // insertBefore index (in original array)
      const insertBefore = upper ? idx : idx + 1;
      await this._moveSoundscape(from, insertBefore);
    });

    return row;
  }

  async _refreshSoundscapeList() {
    const scroll = document.getElementById('ssListScroll');
    if (!scroll) return;
    const soundscapes = await Storage.getSoundscapes();
    const current = this.mixer.currentSoundscape;
    scroll.innerHTML = '';
    soundscapes.forEach((ss, idx) => {
      scroll.appendChild(this._makeSsRow(ss, idx, current));
    });
  }

  async _moveSoundscape(from, insertBefore) {
    const soundscapes = await Storage.getSoundscapes();
    const [moved] = soundscapes.splice(from, 1);
    // Adjust target after removal
    let to = insertBefore > from ? insertBefore - 1 : insertBefore;
    if (to < 0) to = 0;
    if (to > soundscapes.length) to = soundscapes.length;
    soundscapes.splice(to, 0, moved);

    // Keep currentSoundscape pointing at the same entry
    let cur = this.mixer.currentSoundscape;
    if (cur === from) {
      cur = to;
    } else if (from < cur && insertBefore > cur) {
      cur--;
    } else if (from > cur && insertBefore <= cur) {
      cur++;
    }
    this.mixer.currentSoundscape = cur;

    await Storage.setSoundscapes(soundscapes);

    // Update header name
    this.mixer.name = soundscapes[cur].name;
    const nameEl = this._el('soundscapeName');
    if (nameEl) nameEl.value = this.mixer.name ?? '';

    await this._refreshSoundscapeList();
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

  async _saveAmbientVolume(i, val) {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.mixer.currentSoundscape];
    if (!ss) return;
    if (!ss.ambient) ss.ambient = [];
    if (!ss.ambient[i]) ss.ambient[i] = { settings: { volume: 1, name: '' }, soundData: null };
    ss.ambient[i].settings.volume = val;
    await Storage.setSoundscapes(soundscapes);
  }

  async _saveAmbientSetting(i, key, val) {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.mixer.currentSoundscape];
    if (!ss) return;
    if (!ss.ambient) ss.ambient = [];
    if (!ss.ambient[i]) ss.ambient[i] = { settings: { volume: 1, name: '' }, soundData: null };
    ss.ambient[i].settings[key] = val;
    await Storage.setSoundscapes(soundscapes);
  }

  async _saveAmbientMasterVolume(val) {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.mixer.currentSoundscape];
    if (!ss) return;
    if (!ss.ambientMaster) ss.ambientMaster = { volume: 1 };
    ss.ambientMaster.volume = val;
    await Storage.setSoundscapes(soundscapes);
  }

  // ─── MIDI mapping mode ───────────────────────────────────────────────────────

  _toggleMappingMode() {
    if (this._mappingMode) this._exitMappingMode();
    else this._enterMappingMode();
  }

  _enterMappingMode() {
    this._mappingMode = true;
    const el = this._el('midiStatus');
    if (el) el.classList.add('midi-mapping-active');
    this._injectMappingControls();
  }

  _exitMappingMode() {
    this.midi?.cancelListening();
    this._mappingMode = false;
    const el = this._el('midiStatus');
    if (el) el.classList.remove('midi-mapping-active');
    document.querySelectorAll('.midi-map-wrap').forEach(el => el.remove());
  }

  _injectMappingControls() {
    const mappings = this.midi?.getMappings() ?? {};
    for (const entity of MIDI_ENTITIES) {
      const target = document.getElementById(entity.targetId);
      if (!target) continue;
      const mapped = !!mappings[entity.key];

      const wrap = document.createElement('span');
      wrap.className = 'midi-map-wrap';
      wrap.dataset.entity = entity.key;

      const chain = document.createElement('button');
      chain.className = 'midi-chain-btn' + (mapped ? ' midi-chain-mapped' : '');
      chain.title = mapped ? `MIDI: ${_fmtMapping(mappings[entity.key])}` : 'Привязать MIDI';
      chain.textContent = '🔗';

      const trash = document.createElement('button');
      trash.className = 'midi-trash-btn';
      trash.title = 'Удалить привязку';
      trash.textContent = '🗑';
      trash.disabled = !mapped;

      wrap.appendChild(chain);
      wrap.appendChild(trash);

      if (entity.insertInside) {
        target.appendChild(wrap);
      } else {
        target.parentNode?.insertBefore(wrap, target.nextSibling);
      }

      chain.addEventListener('click', e => { e.stopPropagation(); this._onChainClick(entity.key, entity.type, chain); });
      trash.addEventListener('click', e => { e.stopPropagation(); this._onTrashClick(entity.key); });
    }
    this._injectSceneMappingControls();
  }

  _injectSceneMappingControls() {
    // Remove stale scene wraps before re-injecting (scene buttons may have been rebuilt)
    document.querySelectorAll('.midi-map-wrap[data-entity^="scene-"]').forEach(el => el.remove());

    const mappings = this.midi?.getMappings() ?? {};
    document.querySelectorAll('.scene-btn').forEach(btn => {
      const idx = btn.dataset.sceneIdx;
      if (idx == null) return;
      const key    = `scene-${idx}`;
      const mapped = !!mappings[key];

      const wrap = document.createElement('span');
      wrap.className = 'midi-map-wrap';
      wrap.dataset.entity = key;

      const chain = document.createElement('button');
      chain.className = 'midi-chain-btn' + (mapped ? ' midi-chain-mapped' : '');
      chain.title = mapped ? `MIDI: ${_fmtMapping(mappings[key])}` : 'Привязать MIDI';
      chain.textContent = '🔗';

      const trash = document.createElement('button');
      trash.className = 'midi-trash-btn';
      trash.title = 'Удалить привязку';
      trash.textContent = '🗑';
      trash.disabled = !mapped;

      wrap.appendChild(chain);
      wrap.appendChild(trash);
      btn.appendChild(wrap);

      chain.addEventListener('click', e => { e.stopPropagation(); this._onChainClick(key, 'noteon', chain); });
      trash.addEventListener('click', e => { e.stopPropagation(); this._onTrashClick(key); });
    });
  }

  /** Called by app.js via mixer.onSceneRemoved */
  async onSceneRemoved(idx) {
    if (!this.midi) return;
    await this.midi.clearMapping(`scene-${idx}`);
    // Remap remaining scene keys: scene-N+1 → scene-N for indices above removed
    const mappings = this.midi.getMappings();
    const toRemap = Object.entries(mappings)
      .filter(([k]) => { const m = k.match(/^scene-(\d+)$/); return m && +m[1] > idx; });
    for (const [key, val] of toRemap) {
      const newIdx = +key.match(/^scene-(\d+)$/)[1] - 1;
      await this.midi.clearMapping(key);
      await this.midi.setMapping(`scene-${newIdx}`, val);
    }
  }

  _onChainClick(entityKey, type, chainBtn) {
    if (!this.midi) return;
    if (this.midi.getListeningFor() === entityKey) {
      // Toggle off: cancel listening
      this.midi.stopListening();
    } else {
      // Start listening (startListening auto-cancels any previous listener)
      this.midi.startListening(entityKey, type);
      chainBtn.className = 'midi-chain-btn midi-chain-listening';
    }
  }

  async _onTrashClick(entityKey) {
    if (!this.midi) return;
    if (this.midi.getListeningFor() === entityKey) this.midi.stopListening();
    await this.midi.clearMapping(entityKey);
    const wrap = document.querySelector(`.midi-map-wrap[data-entity="${entityKey}"]`);
    if (wrap) {
      const chain = wrap.querySelector('.midi-chain-btn');
      if (chain) { chain.className = 'midi-chain-btn'; chain.title = 'Привязать MIDI'; }
      const trash = wrap.querySelector('.midi-trash-btn');
      if (trash) trash.disabled = true;
    }
  }

  /** Called by midi.onMappingCaptured — mapping was just saved. */
  onMappingCaptured(entityKey, data) {
    const wrap = document.querySelector(`.midi-map-wrap[data-entity="${entityKey}"]`);
    if (wrap) {
      const chain = wrap.querySelector('.midi-chain-btn');
      if (chain) { chain.className = 'midi-chain-btn midi-chain-mapped'; chain.title = `MIDI: ${_fmtMapping(data)}`; }
      const trash = wrap.querySelector('.midi-trash-btn');
      if (trash) trash.disabled = false;
    }
  }

  /** Called by midi.onListeningStop — listening was cancelled or transferred. */
  onListeningStop(prevEntityKey) {
    if (!prevEntityKey) return;
    const mapped = !!this.midi?.getMappings()[prevEntityKey];
    const wrap = document.querySelector(`.midi-map-wrap[data-entity="${prevEntityKey}"]`);
    const chain = wrap?.querySelector('.midi-chain-btn');
    if (chain) chain.className = 'midi-chain-btn' + (mapped ? ' midi-chain-mapped' : '');
  }

  // ─── Data export / import ────────────────────────────────────────────────────

  async _exportMidiMappings() {
    const mappings = this.midi?.getMappings() ?? {};
    if (!Object.keys(mappings).length) {
      alert('Нет сохранённых MIDI-маппингов для экспорта.');
      return;
    }
    await window.api.midi.saveMappings(mappings);
  }

  async _importMidiMappings() {
    const data = await window.api.midi.loadMappings();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    await Storage.setMidiMappings(data);
    if (this.midi) this.midi.mappings = data;
    // Refresh mapping controls if mapping mode is active
    if (this._mappingMode) {
      this._exitMappingMode();
      this._enterMappingMode();
    }
  }

  async _exportData() {
    const soundscapes = await Storage.getSoundscapes();
    const current = soundscapes[this.mixer.currentSoundscape];
    if (!current) return;
    const defaultName = (current.name || `Профиль ${this.mixer.currentSoundscape + 1}`)
      .replace(/[\\/:*?"<>|]/g, '_');
    await window.api.data.save(current, defaultName);
  }

  async _importData() {
    const data = await window.api.data.load();
    if (!data) return;
    const existing = await Storage.getSoundscapes();
    // Support both single-profile objects and legacy full-array exports
    const toAdd = Array.isArray(data) ? data : [data];
    await Storage.setSoundscapes(existing.concat(toAdd));
    await this.mixer.setSoundscape(this.mixer.currentSoundscape);
  }
}
