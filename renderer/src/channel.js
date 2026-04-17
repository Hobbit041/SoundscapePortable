/**
 * channel.js — Standalone port (no Foundry)
 * Key changes from original:
 *   - foundry.utils.duplicate  → structuredClone
 *   - game.socket / Hooks      → removed
 *   - game.playlists/FilePicker → window.api (Electron IPC)
 *   - activeUser               → removed (single-user app)
 */
import { Delay } from './Effects/delay.js';
import { Gain }  from './Effects/gain.js';
import { Pan }   from './Effects/pan.js';
import { EQ }    from './Effects/eq.js';

export class Channel {
  master           = false;
  playing          = false;
  paused           = false;
  duration         = 0;
  sourceArray      = [];
  currentlyPlaying = 0;
  loaded           = false;
  fadeStarted      = false;
  source           = null;
  firstLoop        = true;
  audioElement     = undefined;
  node             = undefined;

  static DEF_SETTINGS = {
    channel: 0, name: '', volume: 1, pan: 0,
    link: false, solo: false, mute: false,
    repeat: { repeat: 'all', minDelay: 0, maxDelay: 0 },
    randomize: false,
    playbackRate: { rate: 1, preservePitch: 1, random: 0 },
    timing: { startTime: 0, stopTime: 0, skipFirstTiming: false, fadeIn: 0, fadeOut: 0, skipFirstFade: false },
    autoPlay: false,
    effects: {
      equalizer: {
        highPass:  { enable: false, frequency: 50,   q: 1 },
        peaking1:  { enable: false, frequency: 500,  q: 1, gain: 1 },
        peaking2:  { enable: false, frequency: 1000, q: 1, gain: 1 },
        lowPass:   { enable: false, frequency: 2000, q: 1 }
      },
      delay: { enable: false, delayTime: 0.25, volume: 0.5 }
    }
  };

  static DEF_SOUNDDATA = {
    soundSelect: 'filepicker_single',
    playlistName: '', soundName: '', source: ''
  };

  constructor(mixer, channelNr) {
    this.mixer     = mixer;
    this.context   = mixer.audioCtx;
    this.channelNr = channelNr;

    this.settings  = structuredClone(Channel.DEF_SETTINGS);
    this.soundData = structuredClone(Channel.DEF_SOUNDDATA);

    if (channelNr === 'master') {
      this.master = true;
      this.effects = {
        gain:          new Gain(1, this.context),
        interfaceGain: new Gain(0.5, this.context)
      };
    } else if (channelNr >= 100) {
      this.effects = { gain: new Gain(1, this.context) };
    } else {
      this.effects = {
        gain:  new Gain(1, this.context),
        pan:   new Pan(0, this.context),
        fft:   undefined,
        eq:    new EQ(this, this.context),
        delay: new Delay(this, this.context)
      };
    }
  }

  // ─── Data loading ────────────────────────────────────────────────────────────

  async setData(data) {
    this.stop(false);
    this.audioElement = undefined;
    this.settings = data.settings ?? structuredClone(Channel.DEF_SETTINGS);

    this.setMute(this.settings.mute);
    this.setSolo(this.settings.solo);
    this.setLink(this.settings.link);
    this.setVolume(this.settings.volume);
    if (this.effects.pan) this.setPan(this.settings.pan);

    if (!data.sourceArray) data.sourceArray = await this.getSounds(data.soundData);
    this.sourceArray = data.sourceArray ?? [];

    if (!this.sourceArray[0]) return;
    this.currentlyPlaying = data.currentlyPlaying ?? 0;
    await this.setSource(this.sourceArray[this.currentlyPlaying]);

    if (this.channelNr !== 'master') {
      this._applyPlaybackRate(this.settings.playbackRate);
      if (this.effects.delay) this.effects.delay.initialize(this.settings.effects?.delay);
      if (this.effects.eq)    this.effects.eq.initialize(this.settings.effects?.equalizer);
    }
  }

  async setSbData(data, currentlyPlaying = 0) {
    const btn = document.getElementById(`sbButton-${data.channel - 100}`);
    if (btn) {
      const rpt = data.repeat?.repeat ?? data.repeat ?? 'none';
      const isLoop = rpt === 'single' || rpt === 'all';
      btn.style.borderColor = isLoop ? 'yellow' : '';
      btn.style.boxShadow   = isLoop ? '0 0 10px yellow' : '';
    }

    this.loaded = false;
    this.stop(false);
    this.settings = data;
    this.setVolume(data.volume ?? 1);

    if (!data.sourceArray) data.sourceArray = await this.getSounds(data.soundData);
    this.sourceArray = data.sourceArray ?? [];

    if (!this.sourceArray[0]) return;
    this.currentlyPlaying = currentlyPlaying;
    await this.setSource(this.sourceArray[currentlyPlaying]);
    this._applyPlaybackRate(data.playbackRate);
  }

  // ─── File resolution ─────────────────────────────────────────────────────────

  async getSounds(soundData) {
    if (!soundData) return [];

    // New playlist format
    if (Array.isArray(soundData.playlist)) {
      const urls = await Promise.all(soundData.playlist.map(item => window.api.fs.toUrl(item.path)));
      return urls.filter(Boolean);
    }

    // Legacy: single file
    let paths = [];
    if (soundData.soundSelect === 'filepicker_single') {
      const src = soundData.source;
      if (!src) return [];
      const exists = await window.api.fs.exists(src);
      if (!exists) {
        const newPath = await this._promptRelink(src);
        if (!newPath) return [];
        soundData.source = newPath;
        paths = [newPath];
      } else {
        paths = [src];
      }
    } else if (soundData.soundSelect === 'filepicker_folder') {
      const src = soundData.source;
      if (!src) return [];
      paths = await window.api.fs.readFolder(src);
      if (paths.length === 0) {
        const newFolder = await this._promptRelinkFolder(src);
        if (newFolder) {
          soundData.source = newFolder;
          paths = await window.api.fs.readFolder(newFolder);
        }
      }
    }

    const urls = await Promise.all(paths.map(p => window.api.fs.toUrl(p)));
    const valid = urls.filter(Boolean);
    return this.settings.randomize ? this._shuffle(valid) : valid;
  }

  async _promptRelink(originalPath) {
    if (!confirm(`File not found:\n${originalPath}\n\nWould you like to locate it?`)) return null;
    const paths = await window.api.fs.openDialog({});
    return paths?.[0] ?? null;
  }

  async _promptRelinkFolder(originalPath) {
    if (!confirm(`Folder not found:\n${originalPath}\n\nWould you like to locate it?`)) return null;
    const paths = await window.api.fs.openDialog({ folder: true });
    return paths?.[0] ?? null;
  }

  _shuffle(array) {
    const a = [...array];
    for (let i = a.length - 1; i >= 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ─── Playback ────────────────────────────────────────────────────────────────

  play(currentTime = undefined) {
    if (!this.loaded || (this.playing && !this.paused && this.channelNr < 100)) return;

    if (!this.audioElement) {
      if (!this.sourceArray?.length) return;
      this.setSource(this.sourceArray[this.currentlyPlaying], false, true);
      return;
    }

    if (this.channelNr >= 100) {
      this._applyPlaybackRate(this.settings.playbackRate ?? { rate: 1, preservePitch: 1, random: 0 });
      this.randomizeVolume();
      const btn = document.getElementById(`sbButton-${this.channelNr - 100}`);
      if (btn) {
        const rpt = this.settings.repeat?.repeat ?? this.settings.repeat ?? 'none';
        btn.style.borderColor = (rpt === 'single' || rpt === 'all') ? 'green' : '';
        btn.style.boxShadow   = (rpt === 'single' || rpt === 'all') ? '0 0 10px green' : '';
      }
    } else {
      this._applyPlaybackRate(this.settings.playbackRate);
    }

    let timing = this.settings.timing ?? { startTime: 0, stopTime: 0, skipFirstTiming: false, fadeIn: 0, fadeOut: 0, skipFirstFade: false };

    if (!this.paused && (!timing.skipFirstTiming || !this.firstLoop)) {
      this.audioElement.currentTime = timing.startTime ?? 0;
    }
    if (timing.fadeIn > 0 && (!timing.skipFirstFade || !this.firstLoop)) {
      if (!this.fadeStarted) this.fade(0, this.settings.volume, timing.fadeIn);
    }
    this.firstLoop = false;

    if (currentTime !== undefined) this.audioElement.currentTime = currentTime;
    if (this.context.state !== 'running') return;

    this.audioElement.play().catch(() => {});
    this.playing = true;
    this.paused  = false;

    const playBtn = document.getElementById(`playSound-${this.channelNr}`);
    if (playBtn) playBtn.innerHTML = '<i class="fas fa-stop"></i>';
  }

  pause() {
    if (!this.audioElement || this.paused || !this.playing) return;
    this.audioElement.pause();
    this.paused = true;
  }

  stop(advanceNext = true) {
    this.firstLoop = true;
    if (!this.audioElement || (!this.playing && !this.paused)) return;

    this.audioElement.pause();
    this.audioElement.currentTime = 0;
    this.playing = false;
    this.paused  = false;

    if (advanceNext) this.next();

    if (this.channelNr >= 100) {
      const btn = document.getElementById(`sbButton-${this.channelNr - 100}`);
      if (btn) {
        const rpt = this.settings.repeat?.repeat ?? this.settings.repeat ?? 'none';
        const isLoop = rpt === 'single' || rpt === 'all';
        btn.style.borderColor = isLoop ? 'yellow' : '';
        btn.style.boxShadow   = isLoop ? '0 0 10px yellow' : '';
      }
    }

    const playBtn = document.getElementById(`playSound-${this.channelNr}`);
    if (playBtn) playBtn.innerHTML = '<i class="fas fa-play"></i>';
  }

  next(playNr = undefined) {
    if (!this.sourceArray?.length) return;
    if (playNr !== undefined) {
      this.currentlyPlaying = playNr;
    } else {
      this.currentlyPlaying++;
      if (this.currentlyPlaying > this.sourceArray.length - 1) this.currentlyPlaying = 0;
    }
    this.setSource(this.sourceArray[this.currentlyPlaying]);
  }

  previous() {
    if (!this.sourceArray?.length) return;
    this.currentlyPlaying--;
    if (this.currentlyPlaying < 0) this.currentlyPlaying = this.sourceArray.length - 1;
    this.setSource(this.sourceArray[this.currentlyPlaying]);
  }

  restart() {
    if (this.audioElement) this.audioElement.currentTime = 0;
  }

  // ─── Source / Audio graph ────────────────────────────────────────────────────

  async setSource(source, stopFirst = false, forcePlay = false) {
    if (!source) return;
    const wasPlaying = this.playing;
    if (this.playing) this.stop(false);

    if (this.node) { try { this.node.disconnect(); } catch {} }

    this.soundData.source = source;
    this.source = source;

    const url = source.startsWith('file://') ? source : await window.api.fs.toUrl(source);

    this.audioElement = document.createElement('audio');
    this.audioElement.crossOrigin = 'anonymous';
    this.audioElement.src = url;
    this.audioElement.volume = 1;

    this.node = this.context.createMediaElementSource(this.audioElement);
    this.configureConnections();
    this.loaded = true;

    if ((wasPlaying && !stopFirst) || forcePlay) this.play();

    this.audioElement.addEventListener('loadeddata', () => {
      this.duration = this.audioElement.duration;
    });
    this.audioElement.addEventListener('timeupdate', () => this._onTimeUpdate());
  }

  _onTimeUpdate() {
    if (this.context.state !== 'running' || !this.audioElement) return;

    let timing = this.settings.timing;
    if (!timing) timing = { startTime: 0, stopTime: 0, fadeIn: 0, fadeOut: 0 };

    let repeat = this.settings.repeat;
    if (!repeat || typeof repeat === 'string') repeat = { repeat: repeat ?? 'none', minDelay: 0, maxDelay: 0 };
    if (repeat.minDelay == null) repeat.minDelay = 0;
    if (repeat.maxDelay == null) repeat.maxDelay = 0;

    let delayTime = repeat.minDelay;
    if (repeat.maxDelay > repeat.minDelay) {
      delayTime = Math.random() * (repeat.maxDelay - repeat.minDelay) * 1000;
    }

    if (this.playing && this.audioElement.paused) {
      if (repeat.repeat === 'none') {
        this.stop();
      } else if (repeat.repeat === 'single') {
        this.randomizeVolume();
        setTimeout(() => {
          if (!this.audioElement) return;
          this.audioElement.currentTime = timing.startTime ?? 0;
          if (this.playing) this.audioElement.play().catch(() => {});
        }, delayTime);
      } else if (repeat.repeat === 'all') {
        this.randomizeVolume();
        setTimeout(() => {
          // Soundboard channels respect the sequential/random playlist setting
          if (this.channelNr >= 100) {
            const sequential = this.settings?.soundData?.sequential ?? false;
            if (!sequential && this.sourceArray?.length > 0) {
              this.next(Math.floor(Math.random() * this.sourceArray.length));
            } else {
              this.next();
            }
          } else {
            this.next();
          }
        }, delayTime);
      }
    }

    if (timing.stopTime > 0 && this.audioElement.currentTime >= timing.stopTime && !this.fadeStarted) {
      if (repeat.repeat === 'none') {
        this.stop();
      } else if (repeat.repeat === 'single') {
        if (timing.fadeIn > 0) this.fade(0, this.settings.volume, timing.fadeIn);
        this.audioElement.currentTime = timing.startTime ?? 0;
      } else if (repeat.repeat === 'all') {
        this.next();
      }
    }

    if (timing.fadeOut > 0 && timing.stopTime > 0 &&
        this.audioElement.currentTime + timing.fadeOut >= timing.stopTime && !this.fadeStarted) {
      this.fade(this.settings.volume, 0, timing.fadeOut);
    }
  }

  configureConnections() {
    if (!this.node) return;
    try { this.node.disconnect(); } catch {}

    if (this.channelNr >= 100) {
      const sbMasterGain = this.mixer.master.effects.gain.node;
      const ifaceGain    = this.mixer.mixer.master.effects.interfaceGain.node;
      this.node
        .connect(this.effects.gain.node)
        .connect(sbMasterGain)
        .connect(ifaceGain)
        .connect(this.context.destination);
    } else {
      const masterGain = this.mixer.master.effects.gain.node;
      const ifaceGain  = this.mixer.master.effects.interfaceGain.node;
      this.node
        .connect(this.effects.gain.node)
        .connect(this.effects.eq.gain)
        .connect(this.effects.pan.node)
        .connect(masterGain)
        .connect(ifaceGain)
        .connect(this.context.destination);
    }
  }

  // ─── Controls ────────────────────────────────────────────────────────────────

  setVolume(volume = this.settings.volume, save = true, solo = false) {
    if (volume == null) volume = this.settings.volume;
    if (volume > 1.25) volume = 1.25;
    if (volume < 0)    volume = 0;
    if (save && !solo) this.settings.volume = volume;
    const actual = this.settings.mute ? 0 : volume;
    if (this.effects.gain) this.effects.gain.set(actual);
  }

  setMute(mute) {
    this.settings.mute = mute;
    if (this.effects.gain) this.effects.gain.set(mute ? 0 : this.settings.volume);
  }

  getMute()  { return this.settings.mute;  }
  setSolo(s) { this.settings.solo = s;     }
  getSolo()  { return this.settings.solo;  }
  setLink(l) { this.settings.link = l;     }
  getLink()  { return this.settings.link;  }

  setPan(pan) {
    this.settings.pan = pan;
    if (this.effects.pan) this.effects.pan.set(pan);
  }

  setPlaybackRate(pbr = this.settings.playbackRate) {
    this._applyPlaybackRate(pbr);
  }

  _applyPlaybackRate(pbr) {
    if (!this.audioElement || !pbr) return;
    let rate = pbr.rate ?? 1;
    if (pbr.random && pbr.random !== 0) {
      rate += (Math.random() - 0.5) * pbr.random;
    }
    rate = Math.max(0.25, Math.min(4, rate));
    if (pbr === this.settings.playbackRate) this.settings.playbackRate = { ...pbr, rate };
    this.audioElement.playbackRate  = rate;
    this.audioElement.preservesPitch = !!pbr.preservePitch;
  }

  fade(start, end, time) {
    if (!this.audioElement || time <= 0) return;
    this.fadeStarted = true;
    const stepSize = (end - start) / (time * 50);
    let volume = start;
    let counter = 0;
    this.audioElement.volume = Math.max(0, Math.min(1, start));

    const interval = setInterval(() => {
      volume += stepSize;
      counter++;
      this.audioElement.volume = Math.max(0, Math.min(1, volume));
      if (counter >= time * 50 - 1) {
        this.audioElement.volume = Math.max(0, Math.min(1, end));
        this.fadeStarted = false;
        clearInterval(interval);
      }
    }, 20);
  }

  randomizeVolume() {
    let volume = this.settings.volume;
    const rv = this.settings.randomizeVolume ?? 0;
    if (rv > 0) {
      volume += (Math.random() - 0.5) * rv;
      volume = Math.max(0, Math.min(1.25, volume));
    }
    if (this.effects.gain) this.effects.gain.set(volume);
  }
}
