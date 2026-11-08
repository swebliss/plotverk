import { App, Notice, Platform, TFile } from 'obsidian';
import { ConfirmModal } from '../modals/prompt-modal';

/**
 * Save an exported manuscript to a location the user chooses. On desktop this
 * opens the OS-native "Save As" dialog (via Obsidian's bundled Electron) and
 * writes to the picked path — anywhere on the computer, outside the vault, and
 * without auto-opening it in another program. On mobile (no native save dialog
 * exists) it falls back to writing the file into the vault at
 * `vaultFallbackPath`. Text payloads are strings; binary payloads (.docx,
 * .epub) are byte arrays.
 */

interface ElectronSaveApi {
	dialog: {
		showSaveDialog: (
			win: unknown,
			opts: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }
		) => Promise<{ canceled: boolean; filePath?: string }>;
	};
	getCurrentWindow?: () => unknown;
}

/** Resolve Electron's save dialog on desktop, or null if unavailable. */
function electronSaveApi(): ElectronSaveApi | null {
	if (!Platform.isDesktopApp) return null;
	try {
		const req = (window as unknown as { require?: (m: string) => unknown }).require;
		const electron = req?.('electron') as
			| { remote?: ElectronSaveApi & { dialog: ElectronSaveApi['dialog'] }; dialog?: ElectronSaveApi['dialog']; getCurrentWindow?: () => unknown }
			| undefined;
		if (!electron) return null;
		// Newer Obsidian exposes @electron/remote; older builds expose dialog directly.
		if (electron.remote?.dialog) return { dialog: electron.remote.dialog, getCurrentWindow: electron.remote.getCurrentWindow };
		if (electron.dialog) return { dialog: electron.dialog, getCurrentWindow: electron.getCurrentWindow };
		return null;
	} catch {
		return null;
	}
}

/** Write bytes/text to an absolute OS path via Node's fs (desktop only). */
async function writeToDisk(absPath: string, data: Uint8Array | string): Promise<void> {
	const req = (window as unknown as { require?: (m: string) => unknown }).require;
	const fs = req?.('fs') as { promises: { writeFile: (p: string, d: Uint8Array | string) => Promise<void> } } | undefined;
	if (!fs) throw new Error('File system unavailable');
	await fs.promises.writeFile(absPath, data);
}

/** Write into the vault (binary or text), overwriting if the file exists. */
async function writeToVault(app: App, path: string, data: Uint8Array | string): Promise<TFile | null> {
	const existing = app.vault.getAbstractFileByPath(path);
	if (typeof data === 'string') {
		if (existing instanceof TFile) { await app.vault.modify(existing, data); return existing; }
		return await app.vault.create(path, data);
	}
	const buf = new ArrayBuffer(data.length);
	new Uint8Array(buf).set(data);
	if (existing instanceof TFile) { await app.vault.modifyBinary(existing, buf); return existing; }
	return await app.vault.createBinary(path, buf);
}

/**
 * Ask before replacing an existing vault file. `ConfirmModal` runs `close()`
 * before `onConfirm`, so the answer is only settled on the next microtask —
 * by then the confirm callback (if any) has already run.
 */
function confirmOverwrite(app: App, path: string): Promise<boolean> {
	return new Promise((resolve) => {
		let confirmed = false;
		const modal = new ConfirmModal(
			app,
			`"${path.split('/').pop()}" already exists. Overwrite it with the new export?`,
			'Overwrite',
			() => { confirmed = true; }
		);
		const baseClose = modal.onClose.bind(modal);
		modal.onClose = () => {
			baseClose();
			queueMicrotask(() => resolve(confirmed));
		};
		modal.open();
	});
}

export interface SaveExportOptions {
	/** File payload — string for text formats, bytes for .docx/.epub. */
	data: Uint8Array | string;
	/** Suggested file name including extension, e.g. "My Book.docx". */
	suggestedName: string;
	/** Human label for the dialog filter, e.g. "Word document". */
	formatLabel: string;
	/** Extension without the dot, e.g. "docx". */
	extension: string;
	/** Where to write on mobile / when no native dialog is available. */
	vaultFallbackPath: string;
}

/**
 * Let the user choose where to save an export. Returns true if a file was
 * written, false if the user cancelled the dialog.
 */
export async function saveExport(app: App, opts: SaveExportOptions): Promise<boolean> {
	const api = electronSaveApi();
	if (api) {
		const win = api.getCurrentWindow?.() ?? null;
		const res = await api.dialog.showSaveDialog(win, {
			defaultPath: opts.suggestedName,
			filters: [{ name: opts.formatLabel, extensions: [opts.extension] }],
		});
		if (res.canceled || !res.filePath) return false;
		try {
			await writeToDisk(res.filePath, opts.data);
			new Notice(`Saved to ${res.filePath}`);
			return true;
		} catch (err) {
			new Notice(`Plotverk: Could not save file. ${err instanceof Error ? err.message : ''}`);
			return false;
		}
	}
	// Mobile / no dialog: keep the file inside the vault, don't auto-open.
	if (app.vault.getAbstractFileByPath(opts.vaultFallbackPath)) {
		if (!(await confirmOverwrite(app, opts.vaultFallbackPath))) return false;
	}
	try {
		await writeToVault(app, opts.vaultFallbackPath, opts.data);
		new Notice(`Saved ${opts.vaultFallbackPath.split('/').pop()} in your vault.`);
		return true;
	} catch (err) {
		new Notice(`Plotverk: Could not save file. ${err instanceof Error ? err.message : ''}`);
		return false;
	}
}
