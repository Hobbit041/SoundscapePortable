/**
 * channelConfigDialog.js
 * Floating config panel for a mixer channel.
 * Replaces soundConfig.js (Foundry FormApplication).
 * Covers: source, repeat, playback rate, timing.
 */
import { Storage } from './storage.js';

export class ChannelConfigDialog {
  constructor(channel, mixer, channelNr) {
    this.channel   = channel;
    this.mixer     = mixer;
    this.channelNr = channelNr;
    this.el        = null;
  }

  async open() {
    // Toggle if already open
    const existing = document.getElementById(`chCfgPanel-${this.channelNr}`);
    if (existing) { existing.remove(); return; }

    const soundscapes = await Storage.getSoundscapes();
    const chData = soundscapes[this.mixer.currentSoundscape]?.channels[this.channelNr];
    if (!chData) return;

    const s   = chData.settings;
    const sd  = chData.soundData ?? {};
    const rpt = (s.repeat && typeof s.repeat === 'object')
      ? s.repeat
      : { repeat: s.repeat ?? 'none', minDelay: 0, maxDelay: 0 };
    const pbr = s.playbackRate ?? { rate: 1, preservePitch: 1, random: 0 };
    const tmg = s.timing ?? { startTime: 0, stopTime: 0, skipFirstTiming: false, fadeIn: 0, fadeOut: 0, skipFirstFade: false };

    const srcName = sd.source ? sd.source.split(/[\\/]/).pop() : '—';
    const isFolder = sd.soundSelect === 'filepicker_folder';

    const panel = document.createElement('div');
    panel.id = `chCfgPanel-${this.channelNr}`;
    panel.className = 'fx-panel cfg-panel';
    panel.innerHTML = `
      <div class="fx-header">
        <span>Config — CH ${this.channelNr + 1}</span>
        <button class="fx-close" id="chCfgClose-${this.channelNr}">✕</button>
      </div>

      <div class="fx-section">
        <div class="fx-section-title">Source</div>
        <div class="fx-row">
          <span class="cfg-src-name" id="chCfgSrcName-${this.channelNr}" title="${sd.source ?? ''}">${isFolder ? srcName + '/' : srcName}</span>
        </div>
        <div class="fx-row">
          <button id="chCfgPickFile-${this.channelNr}"><i class="fas fa-file-audio"></i> File</button>
          <button id="chCfgPickFolder-${this.channelNr}"><i class="fas fa-folder-open"></i> Folder</button>
          <label class="cfg-label" style="margin-left:8px">Shuffle</label>
          <input type="checkbox" id="chCfgRandomize-${this.channelNr}" ${s.randomize ? 'checked' : ''}>
        </div>
      </div>

      <div class="fx-section">
        <div class="fx-section-title">Repeat</div>
        <div class="fx-row">
          <label class="cfg-label">Mode</label>
          <select class="cfg-select" id="chCfgRepeat-${this.channelNr}">
            <option value="none"   ${rpt.repeat === 'none'   ? 'selected' : ''}>None</option>
            <option value="single" ${rpt.repeat === 'single' ? 'selected' : ''}>Loop</option>
            <option value="all"    ${rpt.repeat === 'all'    ? 'selected' : ''}>All files</option>
          </select>
        </div>
        <div class="fx-row">
          <label class="cfg-label">Min delay</label>
          <input class="cfg-num" type="number" id="chCfgMinDelay-${this.channelNr}" min="0" step="0.1" value="${rpt.minDelay ?? 0}">
          <span class="fx-row-unit">s</span>
          <label class="cfg-label">Max delay</label>
          <input class="cfg-num" type="number" id="chCfgMaxDelay-${this.channelNr}" min="0" step="0.1" value="${rpt.maxDelay ?? 0}">
          <span class="fx-row-unit">s</span>
        </div>
      </div>

      <div class="fx-section">
        <div class="fx-section-title">Playback Rate</div>
        <div class="fx-row">
          <label class="cfg-label">Rate</label>
          <input type="range" id="chCfgRate-${this.channelNr}" min="25" max="400" step="1" value="${Math.round((pbr.rate ?? 1) * 100)}">
          <span class="fx-row-val" id="chCfgRateVal-${this.channelNr}">${(pbr.rate ?? 1).toFixed(2)}×</span>
        </div>
        <div class="fx-row">
          <label class="cfg-label">Pitch lock</label>
          <input type="checkbox" id="chCfgPreservePitch-${this.channelNr}" ${pbr.preservePitch ? 'checked' : ''}>
          <label class="cfg-label" style="margin-left:12px">Random ±</label>
          <input type="range" id="chCfgRateRandom-${this.channelNr}" min="0" max="200" step="1" value="${Math.round((pbr.random ?? 0) * 100)}">
          <span class="fx-row-val" id="chCfgRateRandomVal-${this.channelNr}">${(pbr.random ?? 0).toFixed(2)}</span>
        </div>
      </div>

      <div class="fx-section">
        <div class="fx-section-title">Timing</div>
        <div class="fx-row">
          <label class="cfg-label">Start</label>
          <input class="cfg-num" type="number" id="chCfgStart-${this.channelNr}" min="0" step="0.1" value="${tmg.startTime ?? 0}">
          <span class="fx-row-unit">s</span>
          <label class="cfg-label">Stop</label>
          <input class="cfg-num" type="number" id="chCfgStop-${this.channelNr}" min="0" step="0.1" value="${tmg.stopTime ?? 0}">
          <span class="fx-row-unit">s</span>
        </div>
        <div class="fx-row">
          <label class="cfg-label">Skip 1st timing</label>
          <input type="checkbox" id="chCfgSkipTiming-${this.channelNr}" ${tmg.skipFirstTiming ? 'checked' : ''}>
        </div>
        <div class="fx-row">
          <label class="cfg-label">Fade in</label>
          <input class="cfg-num" type="number" id="chCfgFadeIn-${this.channelNr}" min="0" step="0.1" value="${tmg.fadeIn ?? 0}">
          <span class="fx-row-unit">s</span>
          <label class="cfg-label">Fade out</label>
          <input class="cfg-num" type="number" id="chCfgFadeOut-${this.channelNr}" min="0" step="0.1" value="${tmg.fadeOut ?? 0}">
          <span class="fx-row-unit">s</span>
        </div>
        <div class="fx-row">
          <label class="cfg-label">Skip 1st fade</label>
          <input type="checkbox" id="chCfgSkipFade-${this.channelNr}" ${tmg.skipFirstFade ? 'checked' : ''}>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    this.el = panel;
    this._makeDraggable(panel);
    this._bindEvents();
  }

  _bindEvents() {
    const i = this.channelNr;

    document.getElementById(`chCfgClose-${i}`)
      ?.addEventListener('click', () => document.getElementById(`chCfgPanel-${i}`)?.remove());

    // ── Source ──
    document.getElementById(`chCfgPickFile-${i}`)?.addEventListener('click', async () => {
      const paths = await window.api.fs.openDialog({});
      if (!paths?.length) return;
      const src  = paths[0];
      const name = src.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
      document.getElementById(`chCfgSrcName-${i}`).textContent = src.split(/[\\/]/).pop();
      document.getElementById(`chCfgSrcName-${i}`).title = src;
      await this.mixer.newData(i, { type: 'filepicker_single', source: src, name });
    });

    document.getElementById(`chCfgPickFolder-${i}`)?.addEventListener('click', async () => {
      const paths = await window.api.fs.openDialog({ folder: true });
      if (!paths?.length) return;
      const src  = paths[0];
      const name = src.split(/[\\/]/).pop();
      document.getElementById(`chCfgSrcName-${i}`).textContent = name + '/';
      document.getElementById(`chCfgSrcName-${i}`).title = src;
      await this.mixer.newData(i, { type: 'filepicker_folder', source: src, name });
    });

    document.getElementById(`chCfgRandomize-${i}`)?.addEventListener('change', async (e) => {
      await this._saveSetting('randomize', e.target.checked);
    });

    // ── Repeat ──
    document.getElementById(`chCfgRepeat-${i}`)?.addEventListener('change', async (e) => {
      await this._saveRepeat('repeat', e.target.value);
    });
    document.getElementById(`chCfgMinDelay-${i}`)?.addEventListener('change', async (e) => {
      await this._saveRepeat('minDelay', parseFloat(e.target.value) || 0);
    });
    document.getElementById(`chCfgMaxDelay-${i}`)?.addEventListener('change', async (e) => {
      await this._saveRepeat('maxDelay', parseFloat(e.target.value) || 0);
    });

    // ── Playback Rate ──
    document.getElementById(`chCfgRate-${i}`)?.addEventListener('input', async (e) => {
      const rate = e.target.value / 100;
      document.getElementById(`chCfgRateVal-${i}`).textContent = `${rate.toFixed(2)}×`;
      await this._savePlaybackRate('rate', rate);
      if (this.channel.settings.playbackRate) this.channel.settings.playbackRate.rate = rate;
    });
    document.getElementById(`chCfgPreservePitch-${i}`)?.addEventListener('change', async (e) => {
      const v = e.target.checked ? 1 : 0;
      await this._savePlaybackRate('preservePitch', v);
      if (this.channel.settings.playbackRate) this.channel.settings.playbackRate.preservePitch = v;
    });
    document.getElementById(`chCfgRateRandom-${i}`)?.addEventListener('input', async (e) => {
      const rnd = e.target.value / 100;
      document.getElementById(`chCfgRateRandomVal-${i}`).textContent = rnd.toFixed(2);
      await this._savePlaybackRate('random', rnd);
      if (this.channel.settings.playbackRate) this.channel.settings.playbackRate.random = rnd;
    });

    // ── Timing ──
    document.getElementById(`chCfgStart-${i}`)?.addEventListener('change', async (e) => {
      await this._saveTiming('startTime', parseFloat(e.target.value) || 0);
    });
    document.getElementById(`chCfgStop-${i}`)?.addEventListener('change', async (e) => {
      await this._saveTiming('stopTime', parseFloat(e.target.value) || 0);
    });
    document.getElementById(`chCfgSkipTiming-${i}`)?.addEventListener('change', async (e) => {
      await this._saveTiming('skipFirstTiming', e.target.checked);
    });
    document.getElementById(`chCfgFadeIn-${i}`)?.addEventListener('change', async (e) => {
      await this._saveTiming('fadeIn', parseFloat(e.target.value) || 0);
    });
    document.getElementById(`chCfgFadeOut-${i}`)?.addEventListener('change', async (e) => {
      await this._saveTiming('fadeOut', parseFloat(e.target.value) || 0);
    });
    document.getElementById(`chCfgSkipFade-${i}`)?.addEventListener('change', async (e) => {
      await this._saveTiming('skipFirstFade', e.target.checked);
    });
  }

  // ── Storage helpers ──────────────────────────────────────────────────────────

  async _saveSetting(key, value) {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.mixer.currentSoundscape];
    if (!ss) return;
    ss.channels[this.channelNr].settings[key] = value;
    this.channel.settings[key] = value;
    await Storage.setSoundscapes(soundscapes);
  }

  async _saveRepeat(key, value) {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.mixer.currentSoundscape];
    if (!ss) return;
    let rpt = ss.channels[this.channelNr].settings.repeat;
    if (!rpt || typeof rpt === 'string') rpt = { repeat: rpt ?? 'none', minDelay: 0, maxDelay: 0 };
    rpt[key] = value;
    ss.channels[this.channelNr].settings.repeat = rpt;
    this.channel.settings.repeat = rpt;
    await Storage.setSoundscapes(soundscapes);
  }

  async _savePlaybackRate(key, value) {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.mixer.currentSoundscape];
    if (!ss) return;
    let pbr = ss.channels[this.channelNr].settings.playbackRate ?? { rate: 1, preservePitch: 1, random: 0 };
    pbr[key] = value;
    ss.channels[this.channelNr].settings.playbackRate = pbr;
    await Storage.setSoundscapes(soundscapes);
  }

  async _saveTiming(key, value) {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.mixer.currentSoundscape];
    if (!ss) return;
    let tmg = ss.channels[this.channelNr].settings.timing
      ?? { startTime: 0, stopTime: 0, skipFirstTiming: false, fadeIn: 0, fadeOut: 0, skipFirstFade: false };
    tmg[key] = value;
    ss.channels[this.channelNr].settings.timing = tmg;
    this.channel.settings.timing = tmg;
    await Storage.setSoundscapes(soundscapes);
  }

  // ── Drag ─────────────────────────────────────────────────────────────────────

  _makeDraggable(el) {
    let ox = 0, oy = 0, mx = 0, my = 0;
    const header = el.querySelector('.fx-header');
    if (!header) return;
    header.style.cursor = 'move';
    header.addEventListener('mousedown', e => {
      e.preventDefault();
      ox = el.offsetLeft; oy = el.offsetTop;
      mx = e.clientX;     my = e.clientY;
      const onMove = e2 => {
        el.style.left = `${ox + e2.clientX - mx}px`;
        el.style.top  = `${oy + e2.clientY - my}px`;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }
}
