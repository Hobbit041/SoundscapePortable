/**
 * missingFilesRegistry.js
 * Singleton set of file paths that are currently missing on disk.
 * Shared between MixerUI, PlaylistDialog and MissingFilesDialog.
 */
export const MissingFilesRegistry = {
  _paths: new Set(),

  /** Replace the entire set */
  setAll(paths)     { this._paths = new Set(paths); },

  /** Returns true if this path is known-missing */
  has(p)            { return this._paths.has(p); },

  /** Remove a single path (file found or deleted from playlist) */
  remove(p)         { this._paths.delete(p); },

  /** Remove a collection of paths */
  removeMany(paths) { for (const p of paths) this._paths.delete(p); },

  /** Clear all */
  clear()           { this._paths.clear(); },

  /** Returns all missing paths as an array */
  getAll()          { return [...this._paths]; },

  get size()        { return this._paths.size; }
};
