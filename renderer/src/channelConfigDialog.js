/**
 * channelConfigDialog.js
 * Floating config panel for a mixer channel.
 * Replaces soundConfig.js (Foundry FormApplication).
 * Covers: source, repeat, playback rate, timing.
 */
import { Storage }        from './storage.js';
import { PlaylistDialog } from './playlistDialog.js';

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
    const plCount = Array.isArray(sd.playlist) ? sd.playlist.length : (sd.source ? 1 : 0);
    const pan    = s.pan ?? 0;
    const autoPlay = s.autoPlay ?? false;

    const panel = document.createElement('div');
    panel.id = `chCfgPanel-${this.channelNr}`;
    panel.className = 'fx-panel cfg-panel';
    panel.innerHTML = `
      <div class="fx-header">
        <span>Настройка — CH ${this.channelNr + 1}</span>
        <div style="display:flex;gap:4px;align-items:center">
          <button class="cfg-reset-btn" id="chCfgReset-${this.channelNr}" title="Очистить дорожку">🗑</button>
          <button class="fx-close" id="chCfgClose-${this.channelNr}">✕</button>
        </div>
      </div>

      <div class="fx-section">
        <div class="fx-section-title">Источники</div>
        <div class="fx-row">
          <span class="cfg-src-name">${plCount} файл${_plWord(plCount)}</span>
          <button id="chCfgPlaylist-${this.channelNr}"><i class="fas fa-list"></i> Открыть плейлист</button>
        </div>
      </div>

      <div class="fx-section">
        <div class="fx-section-title">Повтор</div>
        <div class="fx-row">
          <label class="cfg-label">Режим</label>
          <select class="cfg-select" id="chCfgRepeat-${this.channelNr}">
            <option value="none"   ${rpt.repeat === 'none'   ? 'selected' : ''}>Нет</option>
            <option value="single" ${rpt.repeat === 'single' ? 'selected' : ''}>Зациклено</option>
            <option value="all"    ${rpt.repeat === 'all'    ? 'selected' : ''}>Все файлы</option>
          </select>
        </div>
        <div class="fx-row">
          <label class="cfg-label">Мин. задержка</label>
          <input class="cfg-num" type="number" id="chCfgMinDelay-${this.channelNr}" min="0" step="0.1" value="${rpt.minDelay ?? 0}">
          <span class="fx-row-unit">s</span>
          <label class="cfg-label">Макс. задержка</label>
          <input class="cfg-num" type="number" id="chCfgMaxDelay-${this.channelNr}" min="0" step="0.1" value="${rpt.maxDelay ?? 0}">
          <span class="fx-row-unit">s</span>
        </div>
      </div>

      <div class="fx-section">
        <div class="fx-section-title">Скорость воспроизведения</div>
        <div class="fx-row">
          <label class="cfg-label">Скорость</label>
          <input type="range" id="chCfgRate-${this.channelNr}" min="25" max="400" step="1" value="${Math.round((pbr.rate ?? 1) * 100)}">
          <span class="fx-row-val" id="chCfgRateVal-${this.channelNr}">${(pbr.rate ?? 1).toFixed(2)}×</span>
        </div>
        <div class="fx-row">
          <label class="cfg-label">Не менять высоту</label>
          <input type="checkbox" id="chCfgPreservePitch-${this.channelNr}" ${pbr.preservePitch ? 'checked' : ''}>
          <label class="cfg-label" style="margin-left:12px">Случайная скорость</label>
          <input type="range" id="chCfgRateRandom-${this.channelNr}" min="0" max="200" step="1" value="${Math.round((pbr.random ?? 0) * 100)}">
          <span class="fx-row-val" id="chCfgRateRandomVal-${this.channelNr}">${(pbr.random ?? 0).toFixed(2)}</span>
        </div>
      </div>

      <div class="fx-section">
        <div class="fx-section-title">Доп. настройки</div>
        <div class="fx-row">
          <label class="cfg-label">Баланс L/R</label>
          <input type="range" id="chCfgPan-${this.channelNr}" min="-25" max="25" step="1" value="${Math.round(pan * 25)}">
          <span class="fx-row-val" id="chCfgPanVal-${this.channelNr}">${pan === 0 ? 'C' : (pan > 0 ? 'R' : 'L') + Math.round(Math.abs(pan * 100)) + '%'}</span>
        </div>
        <div class="fx-row" style="display:none">
          <label class="cfg-label">Start</label>
          <input class="cfg-num" type="number" id="chCfgStart-${this.channelNr}" min="0" step="0.1" value="${tmg.startTime ?? 0}">
          <span class="fx-row-unit">s</span>
          <label class="cfg-label">Stop</label>
          <input class="cfg-num" type="number" id="chCfgStop-${this.channelNr}" min="0" step="0.1" value="${tmg.stopTime ?? 0}">
          <span class="fx-row-unit">s</span>
        </div>
        <div class="fx-row" style="display:none">
          <label class="cfg-label">Skip 1st timing</label>
          <input type="checkbox" id="chCfgSkipTiming-${this.channelNr}" ${tmg.skipFirstTiming ? 'checked' : ''}>
        </div>
        <div class="fx-row">
          <label class="cfg-label">Нарастание</label>
          <input class="cfg-num" type="number" id="chCfgFadeIn-${this.channelNr}" min="0" step="0.1" value="${tmg.fadeIn ?? 0}">
          <span class="fx-row-unit">s</span>
          <label class="cfg-label">Затухание</label>
          <input class="cfg-num" type="number" id="chCfgFadeOut-${this.channelNr}" min="0" step="0.1" value="${tmg.fadeOut ?? 0}">
          <span class="fx-row-unit">s</span>
        </div>
        <div class="fx-row">
          <label class="cfg-label">Воспроизводить при смене сцен</label>
          <input type="checkbox" id="chCfgAutoPlay-${this.channelNr}" ${autoPlay ? 'checked' : ''}>
        </div>
        <div class="fx-row" style="display:none">
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

    // ── Reset ──
    document.getElementById(`chCfgReset-${i}`)?.addEventListener('click', async () => {
      if (!confirm('Вы точно хотите очистить содержимое этой дорожки?')) return;
      await this.mixer.clearChannel(i);
      document.getElementById(`chCfgPanel-${i}`)?.remove();
    });

    // ── Источники ──
    document.getElementById(`chCfgPlaylist-${i}`)?.addEventListener('click', () => {
      new PlaylistDialog({
        title:         `Плейлист — CH ${i + 1}`,
        panelId:       `ch-${i}`,
        getSoundData:  async () => {
          const ss = await Storage.getSoundscapes();
          return ss[this.mixer.currentSoundscape]?.channels[i]?.soundData;
        },
        saveSoundData: async (data) => {
          const ss = await Storage.getSoundscapes();
          if (ss[this.mixer.currentSoundscape]) {
            ss[this.mixer.currentSoundscape].channels[i].soundData = data;
            await Storage.setSoundscapes(ss);
          }
        },
        getChannel: () => this.mixer.channels[i]
      }).open();
    });

    // ── Pan ──
    document.getElementById(`chCfgPan-${i}`)?.addEventListener('input', async (e) => {
      const val = e.target.value / 25;
      const label = Math.abs(Math.round(val * 100));
      document.getElementById(`chCfgPanVal-${i}`).textContent =
        val === 0 ? 'C' : (val > 0 ? `R${label}%` : `L${label}%`);
      this.channel.setPan(val);
      await this._saveSetting('pan', val);
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

    // ── Auto-play on scene switch ──
    document.getElementById(`chCfgAutoPlay-${i}`)?.addEventListener('change', async (e) => {
      await this._saveSetting('autoPlay', e.target.checked);
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

  // ── Helpers ──────────────────────────────────────────────────────────────────

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

function _plWord(n) {
  if (n % 100 >= 11 && n % 100 <= 19) return 'ов';
  const r = n % 10;
  if (r === 1) return '';
  if (r >= 2 && r <= 4) return 'а';
  return 'ов';
}
