/**
 * playlistDialog.js
 * Playlist editor — shared by channel config and soundboard config.
 *
 * Usage:
 *   new PlaylistDialog({
 *     title:         'Плейлист — CH 1',
 *     panelId:       'ch-0',
 *     getSoundData:  async () => soundData,
 *     saveSoundData: async (data) => { ... },
 *     getChannel:    () => liveChannelObject,
 *     mode:          'channel' | 'soundboard'   (default: 'channel')
 *   }).open();
 */

const AUDIO_EXT = new Set(['mp3', 'ogg', 'wav', 'flac', 'm4a', 'opus', 'webm']);

/** Convert a list of File objects (from drop) into playlist items. */
export async function filesToPlaylistItems(files) {
  const items = [];
  for (const file of files) {
    const path = file.path ?? file;
    const ext  = path.split('.').pop().toLowerCase();
    if (AUDIO_EXT.has(ext)) {
      items.push({ path, label: path.split(/[\\/]/).pop() });
    } else {
      const folderFiles = await window.api.fs.readFolder(path);
      if (folderFiles.length) {
        const folderName = path.split(/[\\/]/).pop();
        for (const fp of folderFiles) {
          items.push({ path: fp, label: `/${folderName}/${fp.split(/[\\/]/).pop()}` });
        }
      }
    }
  }
  _sortAlphaItems(items);
  return items;
}

function _sortAlphaItems(arr) {
  arr.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
}

// ─────────────────────────────────────────────────────────────────────────────

export class PlaylistDialog {
  constructor({ title, panelId, getSoundData, saveSoundData, getChannel, mode, onClear }) {
    this.title         = title;
    this.panelId       = panelId;
    this.getSoundData  = getSoundData;
    this.saveSoundData = saveSoundData;
    this.getChannel    = getChannel;
    this._mode         = mode ?? 'channel';
    this._onClear      = onClear ?? null;
    this.playlist      = [];   // [{ path, label }]
    this.shuffle       = false;
    this.sequential    = false;
    this.autoPlay      = false;
    this.selectedSet   = new Set();  // indices of selected rows
    this._anchorIdx    = -1;         // anchor for shift-click range
    this._dragSrcIdx   = null;
  }

  async open() {
    const pid = `plPanel-${this.panelId}`;
    const existing = document.getElementById(pid);
    if (existing) { existing.remove(); return; }

    const soundData   = await this.getSoundData();
    this.playlist     = this._loadPlaylist(soundData);
    this.shuffle      = soundData?.shuffle ?? false;
    this.sequential   = soundData?.sequential ?? false;
    this.autoPlay     = soundData?.autoPlay ?? false;
    this.selectedSet  = new Set();
    this._anchorIdx   = -1;

    const panel = document.createElement('div');
    panel.id        = pid;
    panel.className = 'fx-panel pl-panel';
    panel.innerHTML = `
      <div class="fx-header">
        <span>${this.title}</span>
        <div style="display:flex;gap:4px;align-items:center">
          ${this._onClear ? `<button class="cfg-reset-btn" id="plClear-${this.panelId}" title="Очистить канал">🗑</button>` : ''}
          <button class="fx-close" id="plClose-${this.panelId}">✕</button>
        </div>
      </div>
      <div class="pl-list-wrap" id="plListWrap-${this.panelId}">
        <div class="pl-list" id="plList-${this.panelId}"></div>
        <div class="pl-empty" id="plEmpty-${this.panelId}">Перетащите файлы или папки сюда</div>
      </div>
      <div class="pl-toolbar">
        <button class="pl-btn"         id="plUp-${this.panelId}"   title="Вверх"   disabled>▲</button>
        <button class="pl-btn"         id="plDown-${this.panelId}" title="Вниз"    disabled>▼</button>
        <button class="pl-btn pl-del"  id="plDel-${this.panelId}"  title="Удалить" disabled>🗑</button>
        ${this._mode === 'soundboard'
          ? `<label class="pl-shuffle">
               <input type="checkbox" id="plSequential-${this.panelId}" ${this.sequential ? 'checked' : ''}>
               Воспроизводить поочередно
             </label>`
          : this._mode === 'ambient'
          ? `<label class="pl-shuffle">
               <input type="checkbox" id="plAutoPlay-${this.panelId}" ${this.autoPlay ? 'checked' : ''}>
               Воспроизводить при смене сцен
             </label>
             <label class="pl-shuffle">
               <input type="checkbox" id="plShuffle-${this.panelId}" ${this.shuffle ? 'checked' : ''}>
               Перемешать
             </label>`
          : `<label class="pl-shuffle">
               <input type="checkbox" id="plShuffle-${this.panelId}" ${this.shuffle ? 'checked' : ''}>
               Перемешать
             </label>`
        }
      </div>
    `;

    document.body.appendChild(panel);
    this._makeDraggable(panel);
    this._renderList();
    this._bindEvents();
  }

  // ── Data ─────────────────────────────────────────────────────────────────────

  _loadPlaylist(soundData) {
    if (!soundData) return [];
    if (Array.isArray(soundData.playlist)) return soundData.playlist.map(i => ({ ...i }));
    // Legacy: single file
    if (soundData.soundSelect === 'filepicker_single' && soundData.source) {
      return [{ path: soundData.source, label: soundData.source.split(/[\\/]/).pop() }];
    }
    return [];
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  _renderList() {
    const listEl  = document.getElementById(`plList-${this.panelId}`);
    const emptyEl = document.getElementById(`plEmpty-${this.panelId}`);
    if (!listEl) return;

    if (emptyEl) emptyEl.style.display = this.playlist.length ? 'none' : 'flex';
    listEl.innerHTML = '';

    this.playlist.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className   = 'pl-row' + (this.selectedSet.has(idx) ? ' pl-row-sel' : '');
      row.dataset.idx = idx;
      row.draggable   = true;
      row.innerHTML   = `<span class="pl-row-label" title="${item.path}">${item.label}</span>`;

      row.addEventListener('click',     (e) => this._select(idx, e.shiftKey));
      row.addEventListener('dragstart', e   => this._onRowDragStart(e, idx, row));
      row.addEventListener('dragend',   ()  => this._onRowDragEnd());
      row.addEventListener('dragover',  e   => this._onRowDragOver(e, idx, row));
      row.addEventListener('dragleave', ()  => row.classList.remove('pl-row-over'));
      row.addEventListener('drop',      e   => this._onRowDrop(e, idx));

      listEl.appendChild(row);
    });

    this._updateToolbar();
  }

  _select(idx, shiftHeld = false) {
    if (shiftHeld && this._anchorIdx >= 0) {
      // Extend selection from anchor to idx
      const min = Math.min(this._anchorIdx, idx);
      const max = Math.max(this._anchorIdx, idx);
      this.selectedSet.clear();
      for (let i = min; i <= max; i++) this.selectedSet.add(i);
    } else {
      // Toggle single item; update anchor
      if (this.selectedSet.size === 1 && this.selectedSet.has(idx)) {
        this.selectedSet.clear();
        this._anchorIdx = -1;
      } else {
        this.selectedSet.clear();
        this.selectedSet.add(idx);
        this._anchorIdx = idx;
      }
    }
    this._renderList();
  }

  _updateToolbar() {
    const ok     = this.selectedSet.size > 0;
    const minSel = ok ? Math.min(...this.selectedSet) : -1;
    const maxSel = ok ? Math.max(...this.selectedSet) : -1;
    const upBtn  = this._q(`plUp-${this.panelId}`);
    const dnBtn  = this._q(`plDown-${this.panelId}`);
    const delBtn = this._q(`plDel-${this.panelId}`);
    if (upBtn)  upBtn.disabled  = !ok || minSel === 0;
    if (dnBtn)  dnBtn.disabled  = !ok || maxSel === this.playlist.length - 1;
    if (delBtn) delBtn.disabled = !ok;

    if (this._mode === 'soundboard') {
      const seq = this._q(`plSequential-${this.panelId}`);
      if (seq) seq.checked = this.sequential;
    } else {
      if (this._mode === 'ambient') {
        const ap = this._q(`plAutoPlay-${this.panelId}`);
        if (ap) ap.checked = this.autoPlay;
      }
      const sh = this._q(`plShuffle-${this.panelId}`);
      if (sh) sh.checked = this.shuffle;
    }
  }

  // ── Internal drag (reorder single row) ──────────────────────────────────────

  _onRowDragStart(e, idx, row) {
    this._dragSrcIdx = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
    row.classList.add('pl-row-drag');
  }

  _onRowDragEnd() {
    this._dragSrcIdx = null;
    document.querySelectorAll('.pl-row-drag, .pl-row-over')
      .forEach(el => el.classList.remove('pl-row-drag', 'pl-row-over'));
  }

  _onRowDragOver(e, idx, row) {
    // OS file drag — don't highlight row, let event bubble to wrap handler
    if (this._dragSrcIdx === null) { e.preventDefault(); return; }
    if (this._dragSrcIdx === idx) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.pl-row-over').forEach(el => el.classList.remove('pl-row-over'));
    row.classList.add('pl-row-over');
  }

  _onRowDrop(e, toIdx) {
    // OS file drop — prevent browser navigation but let it bubble to the wrap handler
    if (this._dragSrcIdx === null) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const from = this._dragSrcIdx;
    this._dragSrcIdx = null;
    if (from === toIdx) return;
    this._moveItem(from, toIdx);
  }

  // ── External drop (OS) ───────────────────────────────────────────────────────

  _bindExternalDrop(wrap) {
    wrap.addEventListener('dragover', e => {
      if (this._dragSrcIdx !== null) return;
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      wrap.classList.add('pl-wrap-over');
    });
    wrap.addEventListener('dragleave', e => {
      if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('pl-wrap-over');
    });
    wrap.addEventListener('drop', async e => {
      if (this._dragSrcIdx !== null) return;
      e.preventDefault();
      wrap.classList.remove('pl-wrap-over');
      const files = Array.from(e.dataTransfer.files);
      if (!files.length) return;
      const newItems = await filesToPlaylistItems(files);
      this.playlist.push(...newItems);
      if (this._mode === 'soundboard' || !this.shuffle) _sortAlphaItems(this.playlist);
      await this._save();
      this._renderList();
    });
  }

  // ── Toolbar events ───────────────────────────────────────────────────────────

  _bindEvents() {
    const id = this.panelId;

    this._q(`plClose-${id}`)
      ?.addEventListener('click', () => document.getElementById(`plPanel-${id}`)?.remove());

    if (this._onClear) {
      this._q(`plClear-${id}`)?.addEventListener('click', async () => {
        if (!confirm('Очистить канал?')) return;
        await this._onClear();
        document.getElementById(`plPanel-${id}`)?.remove();
      });
    }

    this._q(`plUp-${id}`)?.addEventListener('click', () => this._moveSelectionUp());
    this._q(`plDown-${id}`)?.addEventListener('click', () => this._moveSelectionDown());

    this._q(`plDel-${id}`)?.addEventListener('click', () => {
      if (this.selectedSet.size === 0) return;
      // Delete all selected, working from highest index down
      const indices = [...this.selectedSet].sort((a, b) => b - a);
      for (const idx of indices) this.playlist.splice(idx, 1);
      this.selectedSet.clear();
      this._anchorIdx = -1;
      this._save();
      this._renderList();
    });

    if (this._mode === 'soundboard') {
      this._q(`plSequential-${id}`)?.addEventListener('change', async e => {
        this.sequential = e.target.checked;
        await this._save();
      });
    } else {
      if (this._mode === 'ambient') {
        this._q(`plAutoPlay-${id}`)?.addEventListener('change', async e => {
          this.autoPlay = e.target.checked;
          await this._save();
        });
      }
      this._q(`plShuffle-${id}`)?.addEventListener('change', async e => {
        this.shuffle = e.target.checked;
        if (this.shuffle) {
          this._shuffleInPlace();
        } else {
          _sortAlphaItems(this.playlist);
          this.selectedSet.clear();
          this._anchorIdx = -1;
        }
        await this._save();
        this._renderList();
      });
    }

    const wrap = document.getElementById(`plListWrap-${id}`);
    if (wrap) this._bindExternalDrop(wrap);
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  /** Move the entire selection up by one position. */
  _moveSelectionUp() {
    if (this.selectedSet.size === 0) return;
    const indices = [...this.selectedSet].sort((a, b) => a - b);
    if (indices[0] === 0) return;
    for (const idx of indices) {
      const [item] = this.playlist.splice(idx, 1);
      this.playlist.splice(idx - 1, 0, item);
    }
    this.selectedSet = new Set(indices.map(i => i - 1));
    if (this._anchorIdx >= 0) this._anchorIdx--;
    if (this._mode !== 'soundboard') this.shuffle = true;
    this._save();
    this._renderList();
  }

  /** Move the entire selection down by one position. */
  _moveSelectionDown() {
    if (this.selectedSet.size === 0) return;
    // Process from highest index to avoid displacement
    const indices = [...this.selectedSet].sort((a, b) => b - a);
    if (indices[0] === this.playlist.length - 1) return;
    for (const idx of indices) {
      const [item] = this.playlist.splice(idx, 1);
      this.playlist.splice(idx + 1, 0, item);
    }
    this.selectedSet = new Set(indices.map(i => i + 1));
    if (this._anchorIdx >= 0) this._anchorIdx++;
    if (this._mode !== 'soundboard') this.shuffle = true;
    this._save();
    this._renderList();
  }

  /** Move a single dragged row (drag-and-drop reorder). */
  _moveItem(from, to) {
    const [item] = this.playlist.splice(from, 1);
    this.playlist.splice(to, 0, item);
    this.selectedSet = new Set([to]);
    this._anchorIdx  = to;
    if (this._mode !== 'soundboard') this.shuffle = true;
    this._save();
    this._renderList();
  }

  _shuffleInPlace() {
    for (let i = this.playlist.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
    }
  }

  async _save() {
    const soundData = { playlist: this.playlist, shuffle: this.shuffle };
    if (this._mode === 'soundboard') soundData.sequential = this.sequential;
    if (this._mode === 'ambient')    soundData.autoPlay    = this.autoPlay;
    await this.saveSoundData(soundData);
    const ch = this.getChannel();
    if (ch) {
      const urls = await Promise.all(this.playlist.map(item => window.api.fs.toUrl(item.path)));
      ch.sourceArray = urls.filter(Boolean);
      if (ch.currentlyPlaying >= ch.sourceArray.length) ch.currentlyPlaying = 0;
      // Keep live settings in sync so playSound() sees the latest sequential flag
      if (ch.settings) ch.settings.soundData = soundData;
    }
  }

  // ── Utils ────────────────────────────────────────────────────────────────────

  _q(id)  { return document.getElementById(id); }

  _makeDraggable(el) {
    let ox = 0, oy = 0, mx = 0, my = 0;
    const hdr = el.querySelector('.fx-header');
    if (!hdr) return;
    hdr.style.cursor = 'move';
    hdr.addEventListener('mousedown', e => {
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
