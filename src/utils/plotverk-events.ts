/**
 * Plotverk's internal message channel ('storygrid:project-changed',
 * 'storygrid:tasks-changed', ...). It used to be the global `document`, but a
 * view dragged into a popout window lives in another document, so sender and
 * listener could miss each other. One window-independent EventTarget fixes that.
 *
 * The names keep the `storygrid:` prefix from the plugin's original name so
 * existing listeners keep matching. The one exception is the settings-changed
 * signal, which other code hears through Obsidian's workspace events instead
 * (see `utils/obsidian-internals.ts`).
 */
export const plotverkEvents = new EventTarget();
