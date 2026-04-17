/**
 * soundboardConfigDialog.js
 * Floating config panel for a soundboard button.
 * Replaces soundboardConfig.js (Foundry FormApplication).
 * Covers: name, source, image, volume, repeat, playback rate.
 */
import { Storage }        from './storage.js';
import { PlaylistDialog } from './playlistDialog.js';

export class SoundboardConfigDialog {
  constructor(soundboard, mixer, btnNr) {
    this.soundboard = soundboard;
    this.mixer      = mixer;
    this.btnNr      = btnNr;
    this.el         = null;
  }

  async open() {
    // Toggle if already open
    const existing = document.getElementById(`sbCfgPanel-${this.btnNr}`);
    if (existing) { existing.remove(); return; }

    const soundscapes = await Storage.getSoundscapes();
    const data = soundscapes[this.mixer.currentSoundscape]?.soundboard?.[this.btnNr];
    if (!data) return;

    const sd  = data.soundData ?? {};
    const pbr = data.playbackRate ?? { rate: 1, preservePitch: 1, random: 0 };
    const rpt = (data.repeat && typeof data.repeat === 'object')
      ? data.repeat
      : { repeat: data.repeat ?? 'none', minDelay: 0, maxDelay: 0 };
    const interrupt = data.interrupt !== false;
    const plCount   = Array.isArray(sd.playlist) ? sd.playlist.length : (sd.source ? 1 : 0);
    const imgName   = data.imageSrc ? data.imageSrc.split(/[\\/]/).pop() : '—';
    const vol  = Math.round((data.volume ?? 1) * 100);
    const rvol = Math.round((data.randomizeVolume ?? 0) * 100);

    const panel = document.createElement('div');
    panel.id = `sbCfgPanel-${this.btnNr}`;
    panel.className = 'fx-panel cfg-panel';
    panel.innerHTML = `
      <div class="fx-header">
        <span>Настройка — SB ${this.btnNr + 1}</span>
        <div style="display:flex;gap:4px;align-items:center">
          <button class="cfg-reset-btn" id="sbCfgReset-${this.btnNr}" title="Очистить кнопку">🗑</button>
          <button class="fx-close" id="sbCfgClose-${this.btnNr}">✕</button>
        </div>
      </div>

      <div class="fx-section">
        <div class="fx-section-title">Название</div>
        <div class="fx-row">
          <input class="cfg-text" type="text" id="sbCfgName-${this.btnNr}"
            value="${(data.name ?? '').replace(/"/g, '&quot;')}"
            placeholder="Название кнопки" spellcheck="false">
        </div>
      </div>

      <div class="fx-section">
        <div class="fx-row">
          <label class="cfg-label">Прервать воспроизведение</label>
          <input type="checkbox" id="sbCfgInterrupt-${this.btnNr}" ${interrupt ? 'checked' : ''}>
        </div>
      </div>

      <div class="fx-section">
        <div class="fx-section-title">Источники</div>
        <div class="fx-row">
          <span class="cfg-src-name">${plCount} файл${_plWord(plCount)}</span>
          <button id="sbCfgPlaylist-${this.btnNr}"><i class="fas fa-list"></i> Открыть плейлист</button>
        </div>
      </div>

      <div class="fx-section">
        <div class="fx-section-title">Изображение</div>
        <div class="fx-row">
          <span class="cfg-src-name" id="sbCfgImgName-${this.btnNr}">${imgName}</span>
          <button id="sbCfgPickImg-${this.btnNr}"><i class="fas fa-image"></i> Выбрать</button>
          <button id="sbCfgClearImg-${this.btnNr}" title="Убрать изображение">✕</button>
        </div>
      </div>

      <div class="fx-section">
        <div class="fx-section-title">Громкость</div>
        <div class="fx-row">
          <label class="cfg-label">Громкость</label>
          <input type="range" id="sbCfgVol-${this.btnNr}" min="0" max="125" step="1" value="${vol}">
          <span class="fx-row-val" id="sbCfgVolVal-${this.btnNr}">${vol}%</span>
        </div>
        <div class="fx-row">
          <label class="cfg-label">Случайная ±</label>
          <input type="range" id="sbCfgRVol-${this.btnNr}" min="0" max="100" step="1" value="${rvol}">
          <span class="fx-row-val" id="sbCfgRVolVal-${this.btnNr}">${rvol}%</span>
        </div>
      </div>

      <div class="fx-section">
        <div class="fx-section-title">Повтор</div>
        <div class="fx-row">
          <label class="cfg-label">Режим</label>
          <select class="cfg-select" id="sbCfgRepeat-${this.btnNr}">
            <option value="none"   ${rpt.repeat === 'none'   ? 'selected' : ''}>Нет</option>
            <option value="single" ${rpt.repeat === 'single' ? 'selected' : ''}>Зациклено</option>
            <option value="all"    ${rpt.repeat === 'all'    ? 'selected' : ''}>Все файлы</option>
          </select>
        </div>
        <div class="fx-row">
          <label class="cfg-label">Мин. задержка</label>
          <input class="cfg-num" type="number" id="sbCfgMinDelay-${this.btnNr}" min="0" step="0.1" value="${rpt.minDelay ?? 0}">
          <span class="fx-row-unit">s</span>
          <label class="cfg-label">Макс. задержка</label>
          <input class="cfg-num" type="number" id="sbCfgMaxDelay-${this.btnNr}" min="0" step="0.1" value="${rpt.maxDelay ?? 0}">
          <span class="fx-row-unit">s</span>
        </div>
      </div>

      <div class="fx-section">
        <div class="fx-section-title">Скорость воспроизведения</div>
        <div class="fx-row">
          <label class="cfg-label">Скорость</label>
          <input type="range" id="sbCfgRate-${this.btnNr}" min="25" max="400" step="1" value="${Math.round((pbr.rate ?? 1) * 100)}">
          <span class="fx-row-val" id="sbCfgRateVal-${this.btnNr}">${(pbr.rate ?? 1).toFixed(2)}×</span>
        </div>
        <div class="fx-row">
          <label class="cfg-label">Не менять высоту</label>
          <input type="checkbox" id="sbCfgPreservePitch-${this.btnNr}" ${pbr.preservePitch ? 'checked' : ''}>
          <label class="cfg-label" style="margin-left:12px">Случайная скорость</label>
          <input type="range" id="sbCfgRateRandom-${this.btnNr}" min="0" max="200" step="1" value="${Math.round((pbr.random ?? 0) * 100)}">
          <span class="fx-row-val" id="sbCfgRateRandomVal-${this.btnNr}">${(pbr.random ?? 0).toFixed(2)}</span>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    this.el = panel;
    this._makeDraggable(panel);
    this._bindEvents();
  }

  _bindEvents() {
    const i = this.btnNr;

    document.getElementById(`sbCfgClose-${i}`)
      ?.addEventListener('click', () => document.getElementById(`sbCfgPanel-${i}`)?.remove());

    // ── Reset ──
    document.getElementById(`sbCfgReset-${i}`)?.addEventListener('click', async () => {
      if (!confirm('Вы точно хотите очистить содержимое этой кнопки?')) return;
      await this.mixer.clearSoundboardButton(i);
      document.getElementById(`sbCfgPanel-${i}`)?.remove();
    });

    // ── Interrupt ──
    document.getElementById(`sbCfgInterrupt-${i}`)?.addEventListener('change', async (e) => {
      await this._saveField('interrupt', e.target.checked);
    });

    // ── Name ──
    document.getElementById(`sbCfgName-${i}`)?.addEventListener('change', async (e) => {
      const name = e.target.value;
      await this._saveField('name', name);
      const label = document.getElementById(`sbLabel-${i}`);
      if (label) label.textContent = name;
    });

    // ── Источники ──
    document.getElementById(`sbCfgPlaylist-${i}`)?.addEventListener('click', () => {
      new PlaylistDialog({
        title:         `Плейлист — SB ${i + 1}`,
        panelId:       `sb-${i}`,
        mode:          'soundboard',
        getSoundData:  async () => {
          const ss = await Storage.getSoundscapes();
          return ss[this.mixer.currentSoundscape]?.soundboard?.[i]?.soundData;
        },
        saveSoundData: async (data) => {
          const ss = await Storage.getSoundscapes();
          if (ss[this.mixer.currentSoundscape]) {
            ss[this.mixer.currentSoundscape].soundboard[i].soundData = data;
            await Storage.setSoundscapes(ss);
          }
        },
        getChannel: () => this.mixer.soundboard.channels[i]
      }).open();
    });

    // ── Image ──
    document.getElementById(`sbCfgPickImg-${i}`)?.addEventListener('click', async () => {
      const paths = await window.api.fs.openDialog({ images: true });
      if (!paths?.length) return;
      const src = paths[0];
      document.getElementById(`sbCfgImgName-${i}`).textContent = src.split(/[\\/]/).pop();
      await this._saveField('imageSrc', src);
      const img = document.getElementById(`sbImg-${i}`);
      if (img) img.src = await window.api.fs.toUrl(src);
    });

    document.getElementById(`sbCfgClearImg-${i}`)?.addEventListener('click', async () => {
      document.getElementById(`sbCfgImgName-${i}`).textContent = '—';
      await this._saveField('imageSrc', '');
      const img = document.getElementById(`sbImg-${i}`);
      if (img) img.src = '';
    });

    // ── Volume ──
    document.getElementById(`sbCfgVol-${i}`)?.addEventListener('input', async (e) => {
      const vol = e.target.value / 100;
      document.getElementById(`sbCfgVolVal-${i}`).textContent = `${e.target.value}%`;
      await this._saveField('volume', vol);
      this.mixer.soundboard.channels[i].setVolume(vol);
    });

    document.getElementById(`sbCfgRVol-${i}`)?.addEventListener('input', async (e) => {
      const rv = e.target.value / 100;
      document.getElementById(`sbCfgRVolVal-${i}`).textContent = `${e.target.value}%`;
      await this._saveField('randomizeVolume', rv);
      this.mixer.soundboard.channels[i].settings.randomizeVolume = rv;
    });

    // ── Repeat ──
    document.getElementById(`sbCfgRepeat-${i}`)?.addEventListener('change', async (e) => {
      await this._saveRepeat('repeat', e.target.value);
    });
    document.getElementById(`sbCfgMinDelay-${i}`)?.addEventListener('change', async (e) => {
      await this._saveRepeat('minDelay', parseFloat(e.target.value) || 0);
    });
    document.getElementById(`sbCfgMaxDelay-${i}`)?.addEventListener('change', async (e) => {
      await this._saveRepeat('maxDelay', parseFloat(e.target.value) || 0);
    });

    // ── Playback Rate ──
    document.getElementById(`sbCfgRate-${i}`)?.addEventListener('input', async (e) => {
      const rate = e.target.value / 100;
      document.getElementById(`sbCfgRateVal-${i}`).textContent = `${rate.toFixed(2)}×`;
      await this._savePlaybackRate('rate', rate);
    });
    document.getElementById(`sbCfgPreservePitch-${i}`)?.addEventListener('change', async (e) => {
      await this._savePlaybackRate('preservePitch', e.target.checked ? 1 : 0);
    });
    document.getElementById(`sbCfgRateRandom-${i}`)?.addEventListener('input', async (e) => {
      const rnd = e.target.value / 100;
      document.getElementById(`sbCfgRateRandomVal-${i}`).textContent = rnd.toFixed(2);
      await this._savePlaybackRate('random', rnd);
    });
  }

  // ── Storage helpers ──────────────────────────────────────────────────────────

  async _saveField(key, value) {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.mixer.currentSoundscape];
    if (!ss) return;
    ss.soundboard[this.btnNr][key] = value;
    // Sync live settings where applicable
    const liveCh = this.mixer.soundboard.channels[this.btnNr];
    if (liveCh) liveCh.settings[key] = value;
    await Storage.setSoundscapes(soundscapes);
  }

  async _saveRepeat(key, value) {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.mixer.currentSoundscape];
    if (!ss) return;
    let rpt = ss.soundboard[this.btnNr].repeat;
    if (!rpt || typeof rpt === 'string') rpt = { repeat: rpt ?? 'none', minDelay: 0, maxDelay: 0 };
    rpt[key] = value;
    ss.soundboard[this.btnNr].repeat = rpt;
    const liveCh = this.mixer.soundboard.channels[this.btnNr];
    if (liveCh) liveCh.settings.repeat = rpt;
    await Storage.setSoundscapes(soundscapes);
  }

  async _savePlaybackRate(key, value) {
    const soundscapes = await Storage.getSoundscapes();
    const ss = soundscapes[this.mixer.currentSoundscape];
    if (!ss) return;
    let pbr = ss.soundboard[this.btnNr].playbackRate ?? { rate: 1, preservePitch: 1, random: 0 };
    pbr[key] = value;
    ss.soundboard[this.btnNr].playbackRate = pbr;
    const liveCh = this.mixer.soundboard.channels[this.btnNr];
    if (liveCh && liveCh.settings) liveCh.settings.playbackRate = pbr;
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

function _plWord(n) {
  if (n % 100 >= 11 && n % 100 <= 19) return 'ов';
  const r = n % 10;
  if (r === 1) return '';
  if (r >= 2 && r <= 4) return 'а';
  return 'ов';
}
