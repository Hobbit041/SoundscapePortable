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
 *     getChannel:    () => liveChannelObject
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
  constructor({ title, panelId, getSoundData, saveSoundData, getChannel }) {
    this.title         = title;
    this.panelId       = panelId;
    this.getSoundData  = getSoundData;
    this.saveSoundData = saveSoundData;
    this.getChannel    = getChannel;
    this.playlist      = [];   // [{ path, label }]
    this.shuffle       = false;
    this.selectedIdx   = -1;
    this._dragSrcIdx   = null;
  }

  async open() {
    const pid = `plPanel-${this.panelId}`;
    const existing = document.getElementById(pid);
    if (existing) { existing.remove(); return; }

    const soundData   = await this.getSoundData();
    this.playlist     = this._loadPlaylist(soundData);
    this.shuffle      = soundData?.shuffle ?? false;
    this.selectedIdx  = -1;

    const panel = document.createElement('div');
    panel.id        = pid;
    panel.className = 'fx-panel pl-panel';
    panel.innerHTML = `
      <div class="fx-header">
        <span>${this.title}</span>
        <button class="fx-close" id="plClose-${this.panelId}">✕</button>
      </div>
      <div class="pl-list-wrap" id="plListWrap-${this.panelId}">
        <div class="pl-list" id="plList-${this.panelId}"></div>
        <div class="pl-empty" id="plEmpty-${this.panelId}">Перетащите файлы или папки сюда</div>
      </div>
      <div class="pl-toolbar">
        <button class="pl-btn"         id="plUp-${this.panelId}"   title="Вверх"   disabled>▲</button>
        <button class="pl-btn"         id="plDown-${this.panelId}" title="Вниз"    disabled>▼</button>
        <button class="pl-btn pl-del"  id="plDel-${this.panelId}"  title="Удалить" disabled>🗑</button>
        <label class="pl-shuffle">
          <input type="checkbox" id="plShuffle-${this.panelId}" ${this.shuffle ? 'checked' : ''}>
          Перемешать
        </label>
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
      row.className   = 'pl-row' + (idx === this.selectedIdx ? ' pl-row-sel' : '');
      row.dataset.idx = idx;
      row.draggable   = true;
      row.innerHTML   = `<span class="pl-row-label" title="${item.path}">${item.label}</span>`;

      row.addEventListener('click',     ()  => this._select(idx));
      row.addEventListener('dragstart', e   => this._onRowDragStart(e, idx, row));
      row.addEventListener('dragend',   ()  => this._onRowDragEnd());
      row.addEventListener('dragover',  e   => this._onRowDragOver(e, idx, row));
      row.addEventListener('dragleave', ()  => row.classList.remove('pl-row-over'));
      row.addEventListener('drop',      e   => this._onRowDrop(e, idx));

      listEl.appendChild(row);
    });

    this._updateToolbar();
  }

  _select(idx) {
    this.selectedIdx = (this.selectedIdx === idx) ? -1 : idx;
    this._renderList();
  }

  _updateToolbar() {
    const sel = this.selectedIdx;
    const ok  = sel >= 0 && sel < this.playlist.length;
    this._q(`plUp-${this.panelId}`).disabled   = !ok || sel === 0;
    this._q(`plDown-${this.panelId}`).disabled  = !ok || sel === this.playlist.length - 1;
    this._q(`plDel-${this.panelId}`).disabled   = !ok;
    const sh = this._q(`plShuffle-${this.panelId}`);
    if (sh) sh.checked = this.shuffle;
  }

  // ── Internal drag (reorder) ──────────────────────────────────────────────────

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
    if (this._dragSrcIdx === null || this._dragSrcIdx === idx) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.pl-row-over').forEach(el => el.classList.remove('pl-row-over'));
    row.classList.add('pl-row-over');
  }

  _onRowDrop(e, toIdx) {
    e.preventDefault();
    e.stopPropagation();
    const from = this._dragSrcIdx;
    this._dragSrcIdx = null;
    if (from === null || from === toIdx) return;
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
      if (!this.shuffle) _sortAlphaItems(this.playlist);
      await this._save();
      this._renderList();
    });
  }

  // ── Toolbar events ───────────────────────────────────────────────────────────

  _bindEvents() {
    const id = this.panelId;

    this._q(`plClose-${id}`)
      ?.addEventListener('click', () => document.getElementById(`plPanel-${id}`)?.remove());

    this._q(`plUp-${id}`)?.addEventListener('click', () => {
      if (this.selectedIdx > 0) this._moveItem(this.selectedIdx, this.selectedIdx - 1);
    });

    this._q(`plDown-${id}`)?.addEventListener('click', () => {
      if (this.selectedIdx < this.playlist.length - 1)
        this._moveItem(this.selectedIdx, this.selectedIdx + 1);
    });

    this._q(`plDel-${id}`)?.addEventListener('click', () => {
      if (this.selectedIdx < 0) return;
      this.playlist.splice(this.selectedIdx, 1);
      this.selectedIdx = -1;
      this._save();
      this._renderList();
    });

    this._q(`plShuffle-${id}`)?.addEventListener('change', async e => {
      this.shuffle = e.target.checked;
      if (this.shuffle) {
        this._shuffleInPlace();
      } else {
        _sortAlphaItems(this.playlist);
        this.selectedIdx = -1;
      }
      await this._save();
      this._renderList();
    });

    const wrap = document.getElementById(`plListWrap-${id}`);
    if (wrap) this._bindExternalDrop(wrap);
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  _moveItem(from, to) {
    const [item] = this.playlist.splice(from, 1);
    this.playlist.splice(to, 0, item);
    this.selectedIdx = to;
    this.shuffle = true; // custom order → mark as shuffled
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
    await this.saveSoundData(soundData);
    const ch = this.getChannel();
    if (ch) {
      const urls = await Promise.all(this.playlist.map(item => window.api.fs.toUrl(item.path)));
      ch.sourceArray = urls.filter(Boolean);
      if (ch.currentlyPlaying >= ch.sourceArray.length) ch.currentlyPlaying = 0;
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
