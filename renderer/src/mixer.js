/**
 * mixer.js — ported from Foundry Soundscape module.
 * Removed: game.socket, Hooks, game.settings, activeUser, MixerApp (FormApplication)
 * Storage is now handled by storage.js (electron-store via IPC)
 */
import { Channel   } from './channel.js';
import { Soundboard } from './soundboard.js';
import { Storage   } from './storage.js';

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
  onUIUpdate = null;   // function() — call to re-render UI

  constructor() {
    this._init();
  }

  async _init() {
    this.audioCtx = new AudioContext();

    for (let i = 0; i < this.mixerSize; i++) {
      this.channels.push(new Channel(this, i));
    }
    this.master     = new Channel(this, 'master');
    this.soundboard = new Soundboard(this);

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

    this.name = settings.name;
    for (let i = 0; i < this.mixerSize; i++) {
      this.channels[i].setData(settings.channels[i]);
    }
    this.master.setVolume(settings.master.settings.volume);
    this.master.setMute(settings.master.settings.mute);
    this.soundboard.configure(settings);

    this.renderUI();

    if (playingTemp || forceStart) {
      setTimeout(() => this.start(), 1000);
    }
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

    if (data.type === 'filepicker_single' || data.type === 'filepicker_folder') {
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
          repeat: 'none', randomize: false,
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
    return {
      name: '',
      channels,
      master: { settings: { volume: 1, mute: false } },
      soundboard,
      soundboardGain: 0.5
    };
  }
}
