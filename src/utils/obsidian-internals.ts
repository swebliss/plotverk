import type { App, Editor, EventRef, Events, Workspace, WorkspaceLeaf } from 'obsidian';
import type { EditorView } from '@codemirror/view';

/**
 * The few places Plotverk reaches past Obsidian's public API, typed in one spot
 * so the rest of the code never needs `any`.
 */

/** Plotverk's own workspace event, fired after its settings are saved. */
export const SETTINGS_CHANGED = 'storygrid:settings-changed';

/** Workspace is an Events object; its custom-event signature takes any name. */
export function onSettingsChanged(workspace: Workspace, callback: () => void): EventRef {
	return (workspace as Events).on(SETTINGS_CHANGED, callback);
}

export function triggerSettingsChanged(workspace: Workspace): void {
	(workspace as Events).trigger(SETTINGS_CHANGED);
}

/** app.commands is not part of the public API. */
export function runCommandById(app: App, id: string): void {
	(app as unknown as { commands?: { executeCommandById(id: string): boolean } }).commands?.executeCommandById(id);
}

/** A leaf's tab header element is not part of the public API. */
export function leafTabHeader(leaf: WorkspaceLeaf | undefined): HTMLElement | undefined {
	return (leaf as unknown as { tabHeaderEl?: HTMLElement } | undefined)?.tabHeaderEl;
}

/** The CodeMirror view behind an Obsidian editor (editor.cm, not public API). */
export function editorView(editor: Editor | undefined): EditorView | undefined {
	return (editor as unknown as { cm?: EditorView } | undefined)?.cm;
}
