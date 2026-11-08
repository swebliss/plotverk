import { App, Modal, Notice } from 'obsidian';
import {
	listSceneSnapshots,
	restoreSceneSnapshot,
	readSceneSnapshot,
	formatSnapshotTimestamp as formatTimestamp,
	SceneSnapshot,
	SnapshotReason,
} from '../utils/scene-snapshots';
import { ConfirmModal } from './prompt-modal';

const REASON_LABEL: Record<SnapshotReason, string> = {
	daily: 'Daily',
	compile: 'Before compile',
	manual: 'Manual snapshot',
	'pre-restore': 'Before restore',
};

/** Browse and restore prior versions of a scene document. */
export class SnapshotBrowserModal extends Modal {
	constructor(
		app: App,
		private scenePath: string,
		private sceneName: string,
		private onRestored?: () => void
	) {
		super(app);
	}

	async onOpen(): Promise<void> {
		this.modalEl.addClass('storygrid-modal', 'sg-snapshot-modal');
		const { contentEl } = this;
		contentEl.createEl('h2', { text: `Snapshots — ${this.sceneName}` });

		const body = contentEl.createDiv({ cls: 'sg-snapshot-body' });
		const loading = body.createEl('p', { text: 'Loading…', cls: 'sg-settings-desc' });

		const snapshots = await listSceneSnapshots(this.app, this.scenePath);
		loading.remove();

		if (snapshots.length === 0) {
			body.createEl('p', {
				cls: 'sg-settings-desc',
				text: 'No snapshots yet. Snapshots are taken automatically before a compile and once a day when you edit this scene, or on-demand with "Snapshot project now".',
			});
			return;
		}

		const list = body.createDiv({ cls: 'sg-snapshot-list' });
		const preview = body.createEl('textarea', { cls: 'sg-snapshot-preview' });
		preview.readOnly = true;

		const actions = contentEl.createDiv({ cls: 'sg-modal-actions' });
		const restoreBtn = actions.createEl('button', {
			cls: 'sg-modal-btn sg-modal-btn-primary',
			text: 'Restore this version',
		});
		restoreBtn.disabled = true;

		let selected: SceneSnapshot | null = null;

		const selectRow = async (row: HTMLElement, snap: SceneSnapshot) => {
			list.querySelectorAll('.sg-snapshot-row.is-active').forEach((el) => el.removeClass('is-active'));
			row.addClass('is-active');
			selected = snap;
			restoreBtn.disabled = false;
			preview.value = await readSceneSnapshot(this.app, snap).catch(() => '');
		};

		let firstRow: HTMLElement | null = null;
		for (const snap of snapshots) {
			const row = list.createDiv({ cls: 'sg-snapshot-row' });
			row.setAttribute('role', 'button');
			row.setAttribute('tabindex', '0');
			row.createSpan({ cls: 'sg-snapshot-row-date', text: formatTimestamp(snap.timestamp) });
			row.createSpan({ cls: 'sg-snapshot-row-reason', text: REASON_LABEL[snap.reason] });
			row.addEventListener('click', () => void selectRow(row, snap));
			row.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void selectRow(row, snap); }
			});
			if (!firstRow) firstRow = row;
		}
		if (firstRow) void selectRow(firstRow, snapshots[0]);

		restoreBtn.addEventListener('click', () => {
			if (!selected) return;
			const snap = selected;
			new ConfirmModal(
				this.app,
				`Restore "${this.sceneName}" to the version from ${formatTimestamp(snap.timestamp)}? The current text is snapshotted first, so this is safe to undo.`,
				'Restore',
				async () => {
					try {
						await restoreSceneSnapshot(this.app, this.scenePath, snap);
						new Notice(`Restored "${this.sceneName}" to ${formatTimestamp(snap.timestamp)}.`);
						this.close();
						this.onRestored?.();
					} catch (err) {
						new Notice(`Plotverk: Could not restore. ${err instanceof Error ? err.message : ''}`);
					}
				}
			).open();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
