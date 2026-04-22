/**
 * mixer.js — ported from Foundry Soundscape module.
 * Removed: game.socket, Hooks, game.settings, activeUser, MixerApp (FormApplication)
 * Storage is now handled by storage.js (electron-store via IPC)
 */
import { Channel      } from './channel.js';
import { Soundboard   } from './soundboard.js';
import { AmbientMixer, AMBIENT_SIZE } from './ambientMixer.js';
import { Storage      } from './storage.js';

export class Mixer {
  mixerSize  = 8;
  currentSoundscape = 0;
  master     = null;
  channels   = [];
  name       = '';
  playing    = false;
  linkArray  = [];
  linkProportion = [];
  highestVolume = 0;
  highestVolumeIteration = 0;

  /** Called by app.js after construction */
  onUIUpdate    = null;   // function() — call to re-render UI
  onSceneRemoved = null;  // (idx) => void — called after a scene is removed
  ui            = null;   // MixerUI instance — set by app.js

  constructor() {
    this._init();
  }

  async _init() {
    this.audioCtx = new AudioContext();

    for (let i = 0; i < this.mixerSize; i++) {
      this.channels.push(new Channel(this, i));
    }
    this.master       = new Channel(this, 'master');
    this.soundboard   = new Soundboard(this);
    this.ambientMixer = new AmbientMixer(this);

    // Resume AudioContext on user interaction (browser policy)
    const resume = () => {
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
    };
    document.addEventListener('click', resume, { once: true });

    await this.setSoundscape(0);
  }

  /** Trigger UI re-render */
  renderUI() {
    if (this.onUIUpdate) this.onUIUpdate();
  }

  // ─── Playback ─────────────────────────────────────────────────────────────

  start(channel = undefined) {
    this.configureSolo();
    this.playing = true;
    if (channel == undefined) {
      for (const ch of this.channels) ch.play();
    } else {
      this.channels[channel].play();
    }
  }

  stop(channel = undefined, fadeOut = false, force = true) {
    if (channel == undefined && fadeOut) {
      this.master.effects.gain.node.gain
        .setTargetAtTime(0, this.audioCtx.currentTime, 0.25);
    }
    if (channel == undefined) {
      this.playing = false;
      for (const ch of this.channels) {
        if (fadeOut) setTimeout(() => ch.stop(force), 1000);
        else ch.stop(force);
      }
    } else {
      this.channels[channel].stop(force);
      this.playing = false;
      for (const ch of this.channels) {
        if (ch.playing) { this.playing = true; return; }
      }
    }
  }

  // ─── Solo / Link ──────────────────────────────────────────────────────────

  configureSolo() {
    const soloOn = this.channels.some(ch => ch.getSolo());
    for (const ch of this.channels) {
      if (!soloOn || ch.getSolo()) ch.setVolume(undefined, undefined, true);
      else ch.setVolume(0, false, true);
    }
  }

  configureLink() {
    this.linkArray = [];
    let highestVolume = 0, highestVolumeIteration = 0;
    for (const ch of this.channels) {
      const link = ch.settings.link;
      this.linkArray[ch.channelNr] = ch.settings.volume > 0 ? link : false;
      if (link) {
        const v = ch.settings.volume;
        if (v > highestVolume) { highestVolume = v; highestVolumeIteration = ch.channelNr; }
        this.linkProportion[ch.channelNr] = v;
      } else {
        this.linkProportion[ch.channelNr] = 0;
      }
    }
    if (highestVolume > 0) {
      for (let i = 0; i < 8; i++) this.linkProportion[i] /= highestVolume;
    }
    this.highestVolume = highestVolume;
    this.highestVolumeIteration = highestVolumeIteration;
  }

  async setLinkVolumes(volume, channel) {
    const diff = volume / this.linkProportion[channel];
    for (const ch of this.channels) {
      let linkVolume = volume;
      if (this.linkArray[ch.channelNr]) {
        linkVolume = this.linkProportion[ch.channelNr] * diff;
      }
      ch.setVolume(linkVolume);
    }
    const soundscapes = await Storage.getSoundscapes();
    for (let i = 0; i < this.mixerSize; i++) {
      if (this.linkArray[i]) {
        soundscapes[this.currentSoundscape].channels[i].settings.volume =
          this.linkProportion[i] * diff;
      }
    }
    await Storage.setSoundscapes(soundscapes);
  }

  // ─── Soundscape Management ────────────────────────────────────────────────

  async setSoundscape(newSoundscape, forceStart = false) {
    const playingTemp = this.playing;
    this.stop(undefined, true);
    this.currentSoundscape = newSoundscape;

    let soundscapes = await Storage.getSoundscapes();
    let settings = soundscapes[this.currentSoundscape];

    if (!settings) {
      settings = this.newSoundscape();
      soundscapes[this.currentSoundscape] = settings;
      await Storage.setSoundscapes(soundscapes);
    }

    // Migrate old soundscapes that lack scenes
    if (!settings.scenes) {
      settings.scenes = [{
        name: 'Scene 1',
        channels: structuredClone(settings.channels),
        ambient:  structuredClone(settings.ambient ?? [])
      }];
      settings.currentScene = 0;
      soundscapes[this.currentSoundscape] = settings;
      await Storage.setSoundscapes(soundscapes);
    }

    // Migrate old soundscapes that lack soundboard scenes
    if (!settings.sbScenes) {
      settings.sbScenes = [{ name: 'SB 1', soundboard: structuredClone(settings.soundboard ?? []) }];
      settings.currentSbScene = 0;
      soundscapes[this.currentSoundscape] = settings;
      await Storage.setSoundscapes(soundscapes);
    }

    this.name = settings.name;
    for (let i = 0; i < this.mixerSize; i++) {
      this.channels[i].setData(settings.channels[i]);
    }
    this.master.setVolume(settings.master.settings.volume);
    this.master.setMute(settings.master.settings.mute);
    this.soundboard.configure(settings);
    this.ambientMixer.configure(settings);

    this.renderUI();

    if (playingTemp || forceStart) {
      setTimeout(() => this.start(), 1000);
    }
  }

  // ─── Scene management ─────────────────────────────────────────────────────────

  async switchScene(newSceneIdx) {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.currentSoundscape];
    if (!ss.scenes || newSceneIdx < 0 || newSceneIdx >= ss.scenes.length) return;
    const curIdx = ss.currentScene ?? 0;
    if (newSceneIdx === curIdx) return;

    // Fade out both mixers
    await this._sceneFadeOut();

    // Stop everything
    this.playing = false;
    for (const ch of this.channels)            ch.stop(false);
    for (const ch of this.ambientMixer.channels) ch.stop();

    // Save current working copy into current scene snapshot
    ss.scenes[curIdx].channels = structuredClone(ss.channels);
    ss.scenes[curIdx].ambient  = structuredClone(ss.ambient ?? []);

    // Load new scene into working copy
    ss.channels     = structuredClone(ss.scenes[newSceneIdx].channels);
    ss.ambient      = structuredClone(ss.scenes[newSceneIdx].ambient ?? []);
    ss.currentScene = newSceneIdx;
    soundscapes[this.currentSoundscape] = ss;
    await Storage.setSoundscapes(soundscapes);

    // Reload audio
    for (let i = 0; i < this.mixerSize; i++) {
      await this.channels[i].setData(ss.channels[i]);
    }
    this.ambientMixer.configure(ss);

    // Fade in
    this._sceneFadeIn(ss.master.settings.volume, ss.ambientMaster?.volume ?? 1);

    // Only channels with autoPlay=true restart after scene switch
    const autoPlayChannels = this.channels.filter(
      ch => ch.settings?.autoPlay && ch.sourceArray?.length
    );
    if (autoPlayChannels.length) {
      this.playing = true;
      this.configureSolo();
      setTimeout(() => { for (const ch of autoPlayChannels) ch.play(); }, 300);
    }

    // Ambient channels: only restart those with autoPlay=true
    for (let i = 0; i < this.ambientMixer.channelCount; i++) {
      const ambEntry = ss.ambient?.[i];
      if (ambEntry?.soundData?.autoPlay && this.ambientMixer.channels[i].sourceArray.length) {
        const ch = this.ambientMixer.channels[i];
        setTimeout(() => {
          ch.play();
          const playEl = document.getElementById(`ambPlay-${i}`);
          if (playEl) playEl.innerHTML = '<i class="fas fa-stop"></i>';
        }, 200);
      }
    }

    this.renderUI();
  }

  async _sceneFadeOut() {
    const ctx = this.audioCtx;
    this.master.effects.gain.node.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    this.ambientMixer.masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    await new Promise(r => setTimeout(r, 1300));
  }

  _sceneFadeIn(masterVol, ambVol) {
    const ctx = this.audioCtx;
    const mGain = this.master.effects.gain.node.gain;
    const aGain = this.ambientMixer.masterGain.gain;

    mGain.cancelScheduledValues(ctx.currentTime);
    mGain.setValueAtTime(0, ctx.currentTime);
    aGain.cancelScheduledValues(ctx.currentTime);
    aGain.setValueAtTime(0, ctx.currentTime);

    const actualMaster = this.master.getMute() ? 0 : masterVol;
    mGain.setTargetAtTime(actualMaster, ctx.currentTime, 0.3);
    aGain.setTargetAtTime(ambVol, ctx.currentTime, 0.3);

    // Restore internal tracking
    setTimeout(() => {
      this.master.effects.gain.gain = actualMaster;
      this.ambientMixer.masterGain.gain.value = ambVol;
    }, 1500);
  }

  async addScene() {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.currentSoundscape];
    if (!ss.scenes) ss.scenes = [];
    if (ss.scenes.length >= 16) return;

    const emptyAmbient = Array.from({ length: AMBIENT_SIZE }, (_, i) => ({
      channel: i,
      settings: { volume: 1, name: '' },
      soundData: { playlist: [], shuffle: false }
    }));
    ss.scenes.push({
      name:     `Scene ${ss.scenes.length + 1}`,
      channels: structuredClone(ss.channels),
      ambient:  emptyAmbient
    });
    soundscapes[this.currentSoundscape] = ss;
    await Storage.setSoundscapes(soundscapes);
    this.renderUI();
  }

  async removeScene(idx) {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.currentSoundscape];
    if (!ss.scenes || ss.scenes.length <= 1) return;

    const curIdx = ss.currentScene ?? 0;
    ss.scenes.splice(idx, 1);

    let newCurIdx = curIdx;
    if (idx === curIdx) {
      newCurIdx = Math.max(0, idx - 1);
      ss.channels = structuredClone(ss.scenes[newCurIdx].channels);
      ss.ambient  = structuredClone(ss.scenes[newCurIdx].ambient ?? []);
    } else if (idx < curIdx) {
      newCurIdx = curIdx - 1;
    }
    ss.currentScene = newCurIdx;
    soundscapes[this.currentSoundscape] = ss;
    await Storage.setSoundscapes(soundscapes);

    if (idx === curIdx) {
      for (let i = 0; i < this.mixerSize; i++) {
        await this.channels[i].setData(ss.channels[i]);
      }
      this.ambientMixer.configure(ss);
    }
    if (this.onSceneRemoved) this.onSceneRemoved(idx);
    this.renderUI();
  }

  // ─── Solo ─────────────────────────────────────────────────────────────────────

  async toggleSolo(i) {
    const ch = this.channels[i];
    if (!ch) return;
    const solo = !ch.getSolo();
    ch.setSolo(solo);
    this.configureSolo();
    const soundscapes = await Storage.getSoundscapes();
    if (soundscapes[this.currentSoundscape]?.channels[i]?.settings) {
      soundscapes[this.currentSoundscape].channels[i].settings.solo = solo;
      await Storage.setSoundscapes(soundscapes);
    }
    this.ui?.updateSolo(i, solo);
  }

  // ─── Soundboard scene management ──────────────────────────────────────────────

  async switchSoundboardScene(newIdx) {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.currentSoundscape];
    if (!ss.sbScenes || newIdx < 0 || newIdx >= ss.sbScenes.length) return;
    const curIdx = ss.currentSbScene ?? 0;
    if (newIdx === curIdx) return;

    // Save current working copy into current snapshot
    ss.sbScenes[curIdx].soundboard = structuredClone(ss.soundboard);

    // Load new snapshot
    ss.soundboard      = structuredClone(ss.sbScenes[newIdx].soundboard);
    ss.currentSbScene  = newIdx;
    soundscapes[this.currentSoundscape] = ss;
    await Storage.setSoundscapes(soundscapes);

    this.soundboard.configure(ss);
    this.renderUI();
  }

  async addSoundboardScene() {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.currentSoundscape];
    if (!ss.sbScenes) ss.sbScenes = [];
    if (ss.sbScenes.length >= 16) return;

    const emptySoundboard = Array.from({ length: 25 }, (_, i) => ({
      channel: 100 + i,
      soundData: { soundSelect: 'filepicker_single', source: '', playlistName: '', soundName: '' },
      playbackRate: { rate: 1, preservePitch: 1, random: 0 },
      name: '', volume: 1, randomizeVolume: 0,
      repeat: { repeat: 'none', minDelay: 0, maxDelay: 0 },
      randomize: false, interrupt: true, imageSrc: ''
    }));

    ss.sbScenes.push({
      name:       `SB ${ss.sbScenes.length + 1}`,
      soundboard: emptySoundboard
    });
    soundscapes[this.currentSoundscape] = ss;
    await Storage.setSoundscapes(soundscapes);
    this.renderUI();
  }

  async removeSoundboardScene(idx) {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.currentSoundscape];
    if (!ss.sbScenes || ss.sbScenes.length <= 1) return;

    const curIdx = ss.currentSbScene ?? 0;
    ss.sbScenes.splice(idx, 1);

    let newCurIdx = curIdx;
    if (idx === curIdx) {
      newCurIdx = Math.max(0, idx - 1);
      ss.soundboard = structuredClone(ss.sbScenes[newCurIdx].soundboard);
    } else if (idx < curIdx) {
      newCurIdx = curIdx - 1;
    }
    ss.currentSbScene = newCurIdx;
    soundscapes[this.currentSoundscape] = ss;
    await Storage.setSoundscapes(soundscapes);

    if (idx === curIdx) {
      this.soundboard.configure(ss);
    }
    this.renderUI();
  }

  async renameSoundboardScene(idx, name) {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.currentSoundscape];
    if (!ss.sbScenes?.[idx]) return;
    ss.sbScenes[idx].name = name;
    soundscapes[this.currentSoundscape] = ss;
    await Storage.setSoundscapes(soundscapes);
  }

  async renameScene(idx, name) {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.currentSoundscape];
    if (!ss.scenes?.[idx]) return;
    ss.scenes[idx].name = name;
    soundscapes[this.currentSoundscape] = ss;
    await Storage.setSoundscapes(soundscapes);
  }

  // ─── Clear / reset ────────────────────────────────────────────────────────────

  async clearChannel(channelNr) {
    this.channels[channelNr].stop(true);
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.currentSoundscape];
    if (!ss) return;
    const def = structuredClone(Channel.DEF_SETTINGS);
    def.channel = channelNr;
    ss.channels[channelNr] = {
      channel:   channelNr,
      soundData: { soundSelect: 'filepicker_single', source: '', playlistName: '', soundName: '' },
      settings:  def
    };
    soundscapes[this.currentSoundscape] = ss;
    await Storage.setSoundscapes(soundscapes);
    await this.channels[channelNr].setData(ss.channels[channelNr]);
    this.renderUI();
  }

  async clearAmbientChannel(i) {
    const ch = this.ambientMixer?.channels[i];
    if (ch) ch.stop();
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.currentSoundscape];
    if (!ss) return;
    if (!ss.ambient) ss.ambient = [];
    ss.ambient[i] = {
      channel: i,
      settings: { volume: 1, name: '' },
      soundData: { playlist: [], shuffle: false }
    };
    soundscapes[this.currentSoundscape] = ss;
    await Storage.setSoundscapes(soundscapes);
    if (ch) {
      ch.sourceArray = [];
      ch.settings = { volume: 1, name: '' };
      ch.gainNode.gain.value = 1;
    }
    this.renderUI();
  }

  async clearSoundboardButton(btnNr) {
    this.soundboard.channels[btnNr]?.stop(true);
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.currentSoundscape];
    if (!ss) return;
    ss.soundboard[btnNr] = {
      channel: 100 + btnNr,
      soundData: { soundSelect: 'filepicker_single', source: '', playlistName: '', soundName: '' },
      playbackRate: { rate: 1, preservePitch: 1, random: 0 },
      name: '', volume: 1, randomizeVolume: 0,
      repeat: { repeat: 'none', minDelay: 0, maxDelay: 0 },
      randomize: false, interrupt: true, imageSrc: ''
    };
    soundscapes[this.currentSoundscape] = ss;
    await Storage.setSoundscapes(soundscapes);
    this.soundboard.configure(ss);
    this.renderUI();
  }

  async insertSoundscape(location) {
    const soundscapes = await Storage.getSoundscapes();
    soundscapes.splice(location, 0, this.newSoundscape());
    await Storage.setSoundscapes(soundscapes);
  }

  async removeSoundscape(location) {
    let soundscapes = await Storage.getSoundscapes();
    soundscapes.splice(location, 1);
    if (this.currentSoundscape > soundscapes.length - 1)
      this.currentSoundscape = soundscapes.length - 1;
    if (soundscapes.length === 0) {
      soundscapes.push(this.newSoundscape());
      this.currentSoundscape = 0;
    }
    await Storage.setSoundscapes(soundscapes);
    await this.setSoundscape(this.currentSoundscape);
  }

  async renameSoundscape(index, name) {
    const soundscapes = await Storage.getSoundscapes();
    soundscapes[index].name = name;
    if (index === this.currentSoundscape) this.name = name;
    await Storage.setSoundscapes(soundscapes);
  }

  async newData(targetId, data) {
    const soundscapes = await Storage.getSoundscapes();
    let chSettings = soundscapes[this.currentSoundscape].channels[targetId];
    if (!chSettings) return;

    if (data.type === 'playlist') {
      chSettings.soundData = { playlist: data.playlist, shuffle: false };
      if (!chSettings.settings.name && data.name) chSettings.settings.name = data.name;
    } else if (data.type === 'filepicker_single' || data.type === 'filepicker_folder') {
      chSettings.soundData.source = data.source;
      if (!chSettings.settings.name) chSettings.settings.name = data.name ?? '';
      chSettings.soundData.soundSelect = data.type;
    }

    soundscapes[this.currentSoundscape].channels[targetId] = chSettings;
    this.channels[targetId].setData(chSettings);
    await Storage.setSoundscapes(soundscapes);
    this.renderUI();
  }

  newSoundscape() {
    const channels = [];
    for (let i = 0; i < 8; i++) {
      channels[i] = {
        channel: i,
        soundData: { soundSelect: 'filepicker_single', source: '', playlistName: '', soundName: '' },
        settings: {
          channel: i, name: '', volume: 1, pan: 0,
          link: false, solo: false, mute: false,
          repeat: { repeat: 'all', minDelay: 0, maxDelay: 0 }, randomize: false,
          playbackRate: { rate: 1, preservePitch: 1, random: 0 },
          timing: { startTime: 0, stopTime: 0, skipFirstTiming: false, fadeIn: 0, fadeOut: 0, skipFirstFade: false },
          effects: {
            equalizer: {
              highPass:  { enable: false, frequency: 50,   q: 1 },
              peaking1:  { enable: false, frequency: 500,  q: 1, gain: 1 },
              peaking2:  { enable: false, frequency: 1000, q: 1, gain: 1 },
              lowPass:   { enable: false, frequency: 2000, q: 1 }
            },
            delay: { enable: false, delayTime: 0.25, volume: 0.5 }
          }
        }
      };
    }
    const soundboard = [];
    for (let i = 0; i < 25; i++) {
      soundboard.push({
        channel: 100 + i,
        soundData: { soundSelect: 'filepicker_single', source: '', playlistName: '', soundName: '' },
        playbackRate: { rate: 1, preservePitch: 1, random: 0 },
        name: '', volume: 1, randomizeVolume: 0,
        repeat: { repeat: 'none', minDelay: 0, maxDelay: 0 },
        randomize: false, interrupt: true, imageSrc: ''
      });
    }
    const ambient = Array.from({ length: AMBIENT_SIZE }, (_, i) => ({
      channel: i,
      settings: { volume: 1, name: '' },
      soundData: { playlist: [], shuffle: false }
    }));

    return {
      name: '',
      currentScene: 0,
      scenes: [{
        name:     'Scene 1',
        channels: structuredClone(channels),
        ambient:  structuredClone(ambient)
      }],
      channels,
      master: { settings: { volume: 1, mute: false } },
      soundboard,
      soundboardGain: 0.75,
      sbScenes: [{ name: 'SB 1', soundboard: structuredClone(soundboard) }],
      currentSbScene: 0,
      ambient,
      ambientMaster: { volume: 1 }
    };
  }
}
