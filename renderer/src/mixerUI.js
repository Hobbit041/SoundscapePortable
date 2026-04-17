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
    document.addEventListener('keydown', e => { if (e.key === 'Control' || e.key === 'Meta') this._controlDown = true; });
    document.addEventListener('keyup',   e => { if (e.key === 'Control' || e.key === 'Meta') this._controlDown = false; });

    // ── MIDI mapping mode ──
    this._on('midiStatus', 'click', () => this._toggleMappingMode());

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
    this._on(`ambConfig-${i}`, 'click', () => {
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
        getChannel: () => this.mixer.ambientMixer?.channels[i]
      }).open();
    });

    // Name input
    this._on(`ambName-${i}`, 'change', async (e) => {
      await this._saveAmbientSetting(i, 'name', e.target.value);
      const ch = this.mixer.ambientMixer?.channels[i];
      if (ch) ch.settings.name = e.target.value;
    });

    // Drag-and-drop
    const box = this._el(`ambBox-${i}`);
    if (box) {
      box.addEventListener('dragover',  e => { e.preventDefault(); box.classList.add('drag-over'); });
      box.addEventListener('dragleave', () => box.classList.remove('drag-over'));
      box.addEventListener('drop', async (e) => {
        e.preventDefault();
        box.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files);
        if (!files.length) return;
        const playlist = await filesToPlaylistItems(files);
        const ss = await Storage.getSoundscapes();
        if (ss[this.mixer.currentSoundscape]) {
          if (!ss[this.mixer.currentSoundscape].ambient)
            ss[this.mixer.currentSoundscape].ambient = [];
          if (!ss[this.mixer.currentSoundscape].ambient[i])
            ss[this.mixer.currentSoundscape].ambient[i] =
              { settings: { volume: 1, name: '' }, soundData: {} };
          ss[this.mixer.currentSoundscape].ambient[i].soundData = { playlist, shuffle: false };
          await Storage.setSoundscapes(ss);
          const ch = this.mixer.ambientMixer?.channels[i];
          if (ch) {
            const urls = await Promise.all(playlist.map(item => window.api.fs.toUrl(item.path)));
            ch.sourceArray = urls.filter(Boolean);
          }
        }
      });
    }
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
