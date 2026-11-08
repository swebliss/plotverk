import { App, Modal } from 'obsidian';

// ─── Sprint setup ─────────────────────────────────────────────────────────────

/**
 * Open the sprint setup modal. Collects duration + optional word goal,
 * then calls onSubmit so the plugin can start the sprint.
 */
export function openSprintSetup(
	app: App,
	defaultMinutes: number,
	onSubmit: (minutes: number, wordGoal: number) => void
): void {
	new SprintSetupModal(app, defaultMinutes, onSubmit).open();
}

class SprintSetupModal extends Modal {
	constructor(
		app: App,
		private defaultMinutes: number,
		private onSubmit: (minutes: number, wordGoal: number) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('storygrid-modal');
		const { contentEl } = this;
		contentEl.addClass('sg-sprint-setup');

		contentEl.createEl('h2', { text: 'Start a sprint' });

		const durationRow = contentEl.createDiv({ cls: 'sg-sprint-setup-row' });
		durationRow.createEl('label', {
			cls: 'sg-sprint-setup-label',
			text: 'Duration (minutes)',
			attr: { for: 'sg-sprint-setup-duration' },
		});
		const durationInput = durationRow.createEl('input', {
			type: 'number',
			cls: 'sg-sprint-setup-input',
			attr: { id: 'sg-sprint-setup-duration' },
		});
		durationInput.value = String(this.defaultMinutes);
		durationInput.min = '1';
		durationInput.max = '120';
		durationInput.step = '5';

		const goalRow = contentEl.createDiv({ cls: 'sg-sprint-setup-row' });
		goalRow.createEl('label', {
			cls: 'sg-sprint-setup-label',
			text: 'Word goal (optional)',
			attr: { for: 'sg-sprint-setup-goal' },
		});
		const goalInput = goalRow.createEl('input', {
			type: 'number',
			cls: 'sg-sprint-setup-input',
			attr: { id: 'sg-sprint-setup-goal' },
		});
		goalInput.placeholder = 'e.g. 500';
		goalInput.min = '0';

		const actions = contentEl.createDiv({ cls: 'sg-modal-actions' });
		const startBtn = actions.createEl('button', {
			cls: 'sg-modal-btn sg-modal-btn-primary',
			text: 'Start sprint',
		});

		const submit = () => {
			const mins = parseInt(durationInput.value, 10);
			const goal = parseInt(goalInput.value, 10) || 0;
			if (mins > 0) {
				this.close();
				this.onSubmit(mins, goal);
			}
		};
		startBtn.addEventListener('click', submit);
		durationInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
		goalInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

		durationInput.focus();
		durationInput.select();
	}

	onClose(): void { this.contentEl.empty(); }
}

// ─── Sprint summary ───────────────────────────────────────────────────────────

/**
 * Show the sprint-complete summary. Called by the plugin when the countdown
 * reaches zero or the writer stops early.
 */
export function showSprintSummary(
	app: App,
	wordsWritten: number,
	elapsedMs: number,
	streak: number,
	lastDurationMinutes: number,
	onRepeat: (minutes: number) => void,
	sprintStats?: { today: number; total: number; totalWords: number }
): void {
	new SprintSummaryModal(app, wordsWritten, elapsedMs, streak, lastDurationMinutes, onRepeat, sprintStats).open();
}

class SprintSummaryModal extends Modal {
	constructor(
		app: App,
		private wordsWritten: number,
		private elapsedMs: number,
		private streak: number,
		private lastDurationMinutes: number,
		private onRepeat: (minutes: number) => void,
		private sprintStats?: { today: number; total: number; totalWords: number }
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('storygrid-modal');
		const { contentEl } = this;
		contentEl.addClass('sg-sprint-summary');

		const elapsedMinutes = Math.max(1, Math.round(this.elapsedMs / 60_000));
		const wpm = this.elapsedMs > 0
			? Math.round((this.wordsWritten / this.elapsedMs) * 60_000)
			: 0;

		contentEl.createEl('h2', { text: 'Sprint complete!' });

		const stat = contentEl.createDiv({ cls: 'sg-sprint-stat' });
		stat.createDiv({ cls: 'sg-sprint-stat-count', text: this.wordsWritten.toLocaleString() });
		stat.createDiv({
			cls: 'sg-sprint-stat-label',
			text: `words in ${elapsedMinutes} minute${elapsedMinutes !== 1 ? 's' : ''}`,
		});
		if (wpm > 0) {
			stat.createDiv({ cls: 'sg-sprint-wpm', text: `${wpm} words / min` });
		}

		if (this.sprintStats && this.sprintStats.today > 0) {
			contentEl.createDiv({
				cls: 'sg-sprint-count',
				text: `🏁 Sprint #${this.sprintStats.today} today · ${this.sprintStats.total} all time`,
			});
		}

		if (this.streak > 0) {
			contentEl.createDiv({
				cls: 'sg-sprint-streak',
				text: `🔥 ${this.streak}-day writing streak`,
			});
		}

		const actions = contentEl.createDiv({ cls: 'sg-modal-actions' });
		const againBtn = actions.createEl('button', {
			cls: 'sg-modal-btn sg-modal-btn-primary',
			text: `Sprint again (${this.lastDurationMinutes} min)`,
		});
		const doneBtn = actions.createEl('button', { cls: 'sg-modal-btn', text: 'Done' });

		againBtn.addEventListener('click', () => {
			this.close();
			this.onRepeat(this.lastDurationMinutes);
		});
		doneBtn.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
