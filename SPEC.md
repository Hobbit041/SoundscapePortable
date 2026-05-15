# SoundscapePortable — Спецификация правок

## Баг 1 — Новая сцена наследует данные текущей сцены

### Описание
При создании новой сцены через кнопку «+» каналы новой сцены инициализируются копией текущего рабочего состояния каналов (`ss.channels`), а не пустыми шаблонами.

### Воспроизведение
1. Загрузить звуки на несколько дорожек.
2. Нажать «+» для создания новой сцены.
3. Новая сцена содержит те же дорожки, что и предыдущая.

### Корневая причина
`mixer.js → addScene()`: строка `channels: structuredClone(ss.channels)` клонирует текущий рабочий массив каналов вместо создания пустого.

### Исправление
Заменить `structuredClone(ss.channels)` на `makeEmptyChannelArray(MIXER_SIZE)`.

**Файл:** `renderer/src/mixer.js`, метод `addScene()` (~строка 321)

---

## Баг 2 — AutoPlay при смене сцены не обновляет UI

### Описание
При смене сцены дорожки с включённым «Воспроизводить при смене сцен» запускаются через `setTimeout`, но UI не обновляется после их запуска: кнопка воспроизведения и рамка канала не меняют цвет.

### Воспроизведение
1. На дорожке включить «Воспроизводить при смене сцен».
2. Переключить сцену.
3. Звук воспроизводится, но кнопка play и рамка канала остаются «серыми».

### Корневая причина
`mixer.js → switchScene()`: `renderUI()` вызывается до того, как `setTimeout(300ms)` запустит `ch.play()`, поэтому `ch.playing` ещё false в момент рендера.

### Исправление
Добавить `this.renderUI()` внутрь callback'а setTimeout после всех `ch.play()`.

**Файл:** `renderer/src/mixer.js`, метод `switchScene()` (~строка 267)

---

## Баг 3 — ESC при редактировании имени сцены замораживает кнопку

### Описание
При нажатии ESC во время редактирования имени сцены (правый клик → редактирование) ввод прекращается, но поле ввода не заменяется кнопкой сцены — UI зависает в состоянии редактирования навсегда.

### Воспроизведение
1. Правый клик на кнопку сцены.
2. В появившемся поле ввода нажать ESC.
3. Поле ввода остаётся в DOM; выйти из режима редактирования невозможно.

### Корневая причина
`mixerUI.js → _editScene()` и `_editSbScene()`: при нажатии ESC выставляется флаг `trashClicked = true` и вызывается `input.blur()`. Обработчик `blur → finishEdit()` немедленно возвращается `if (trashClicked) return`, не вызывая `_renderScenes()`. Поле ввода остаётся в DOM вместо кнопки.

### Исправление
Разделить «отмена ввода» (ESC) и «клик по корзине» на отдельные флаги. Перестроить `finishEdit` так, чтобы `_renderScenes()` / `_renderSbScenes()` вызывался всегда, кроме случая клика по корзине (где перерисовка происходит через `removeScene → renderUI`).

```js
// До исправления
const finishEdit = async () => {
  if (trashClicked) return;            // ← ESC сюда попадает и выходит без рендера
  ...
  this._renderScenes(...);
};

// После исправления
let cancelled = false;
// ESC handler: cancelled = true; input.blur();
const finishEdit = async () => {
  if (trashClicked) return;            // только корзина — выходим без рендера
  if (!cancelled) {
    await this.mixer.renameScene(idx, newName);
  }
  this._renderScenes(...);             // всегда вызывается (ESC или Enter/blur)
};
```

**Файл:** `renderer/src/mixerUI.js`, методы `_editScene()` (~строка 789) и `_editSbScene()` (~строка 870)

---

## Баг 4 — Перетаскивание нескольких выделенных файлов в очереди воспроизведения

### Описание
Три проблемы при drag-and-drop в плейлисте:

1. **Только один файл перемещается**, когда выделено несколько — остальные выделенные игнорируются.
2. **Нельзя перенести файлы после последнего** — нет зоны сброса за последним элементом.
3. **Выделение сбрасывается** после перемещения вместо сохранения на перемещённых файлах.

### Воспроизведение (проблема 1)
1. Очередь: [1, 2, 3, 4].
2. Shift+клик: выбрать файлы 1 и 2.
3. Перетащить группу между 3 и 4 (на файл 4).
4. **Ожидаемо:** [3, 1, 2, 4]. **Фактически:** [1, 3, 4, 2].

### Корневая причина
`playlistDialog.js → _onRowDrop`: вызывает `_moveItem(from, toIdx)` только для одного элемента (элемент, с которого начат drag), игнорируя `selectedSet`.

### Алгоритм перемещения группы (toIdx — индекс строки, на которую сброшено)
```
before = кол-во выделенных индексов < toIdx
adjustedTo = toIdx - before
items = выделенные элементы в порядке индексов
удалить из playlist начиная с наибольшего индекса
вставить items по adjustedTo
selectedSet = {adjustedTo, adjustedTo+1, ..., adjustedTo + items.length - 1}
```

Пример: playlist=[1,2,3,4], selected=[0,1], toIdx=3 (на файл 4):
- before=2, adjustedTo=1
- удалить [1,2]: остаток [3,4]
- вставить [1,2] на позицию 1: [3,1,2,4] ✓

### Исправление
1. Добавить метод `_moveSelectedItems(toIdx)` с алгоритмом выше.
2. В `_onRowDrop`: если `selectedSet.size > 1` и `selectedSet.has(from)` → вызвать `_moveSelectedItems(toIdx)`, иначе `_moveItem(from, toIdx)`.
3. Добавить в `_renderList()` зону сброса в конце списка (`.pl-end-zone`) — позволяет перенести файлы после последнего элемента.
4. В `_moveItem`: использовать `Math.min(to, this.playlist.length)` как insertAt для корректного обновления `selectedSet` при сбросе в конец.
5. No-op проверка в `_moveSelectedItems`: если `toIdx >= minSel && toIdx <= maxSel + 1`, ничего не делать.

**Файл:** `renderer/src/playlistDialog.js`

---

## Баг 5 — Нативные диалоги confirm/alert блокируют ввод текста

### Описание
После закрытия нативного системного диалога (`confirm()` / `alert()`), создаваемого ОС (не программой), фокус в рендерере Electron теряется. Текстовый ввод блокируется до тех пор, пока пользователь не переключит фокус на другое окно и обратно.

### Воспроизведение
1. Нажать ПКМ по любой дорожке → очистить дорожку.
2. В системном диалоге «Точно удалить?» нажать любой вариант.
3. Нажать ПКМ по любому текстовому полю в программе.
4. Попытаться ввести текст — ввод заблокирован.

### Корневая причина
Нативные `confirm()` и `alert()` реализованы системой, а не рендерером. После закрытия DOM-контекст теряет фокус в Electron.

### Список всех мест с нативными диалогами
| Файл | Строка | Вызов |
|------|--------|-------|
| `channel.js` | 157 | `confirm('File not found:...')` |
| `channel.js` | 163 | `confirm('Folder not found:...')` |
| `channelConfigDialog.js` | 148 | `confirm(t('channelConfig.clearConfirm'))` |
| `mixerUI.js` | 1350 | `confirm(t('profiles.deleteConfirm'))` |
| `mixerUI.js` | 1707 | `alert(t('midi.noMappingsAlert'))` |
| `mixerUI.js` | 1779 | `alert(t('missingFiles.noMissing'))` |
| `mixerUI.js` | 1856 | `alert(t('settings.noProfilesAlert'))` |
| `playlistDialog.js` | 315 | `confirm(t('playlist.clearConfirm'))` |
| `soundboardConfigDialog.js` | 151 | `confirm(t('soundboardConfig.clearConfirm'))` |

### Исправление
Создать `renderer/src/dialog.js` с двумя утилитами:
- `showConfirm(message)` → `Promise<boolean>` — кнопки ОК / Отмена
- `showAlert(message)` → `Promise<void>` — кнопка ОК

Диалоги стилизуются аналогично существующим внутренним панелям (`settings-overlay`, `fx-panel`, `settings-btn`). Добавить в `translations/ru.json` ключи `dialog.ok` и `dialog.cancel`.

Заменить все `confirm()` на `await showConfirm(...)` и все `alert()` на `await showAlert(...)` во всех перечисленных файлах.

**Файлы:** `renderer/src/dialog.js` (новый), `renderer/src/channel.js`, `renderer/src/channelConfigDialog.js`, `renderer/src/mixerUI.js`, `renderer/src/playlistDialog.js`, `renderer/src/soundboardConfigDialog.js`, `translations/ru.json`
