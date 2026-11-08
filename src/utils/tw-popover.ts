import type StorygridPlugin from '../main';

/**
 * Opens a small settings popover anchored above the status-bar typewriter
 * indicator. Sliders apply immediately so the writer gets live feedback.
 */
export function showTypewriterPopover(anchor: HTMLElement, plugin: StorygridPlugin): void {
	document.querySelector('.sg-tw-popover')?.remove();

	const s = plugin.settings;
	const pop = document.body.createDiv({ cls: 'sg-tw-popover' });

	// ── Header — toggle ──────────────────────────────────────────────────────
	const head = pop.createDiv({ cls: 'sg-tw-pop-head' });
	head.createSpan({ cls: 'sg-tw-pop-title', text: 'Typewriter mode' });
	const togBtn = head.createEl('button', {
		cls: 'sg-tw-pop-toggle' + (s.typewriterMode ? ' is-active' : ''),
		text: s.typewriterMode ? 'ON' : 'OFF',
	});
	togBtn.setAttribute('aria-pressed', String(s.typewriterMode));
	togBtn.addEventListener('click', () => {
		pop.remove();
		void plugin.toggleTypewriterMode();
	});

	// ── Scope ─────────────────────────────────────────────────────────────────
	const scopeRow = pop.createDiv({ cls: 'sg-tw-pop-row' });
	scopeRow.createSpan({ cls: 'sg-tw-pop-label', text: 'Active in' });
	const scopeWrap = scopeRow.createDiv({ cls: 'sg-tw-pop-scope' });
	for (const [val, label] of [['all', 'All files'], ['scenes', 'Scene files only']] as const) {
		const lb = scopeWrap.createEl('label', { cls: 'sg-tw-pop-scope-opt' });
		const rb = lb.createEl('input', { type: 'radio' });
		rb.name = 'sg-tw-scope';
		rb.value = val;
		rb.checked = (s.typewriterScope ?? 'all') === val;
		lb.createSpan({ text: label });
		rb.addEventListener('change', () => {
			s.typewriterScope = val;
			void plugin.saveData(s);
			plugin.refreshTypewriterMode();
		});
	}

	// ── Line position ─────────────────────────────────────────────────────────
	addSlider(pop, 'Line position', 10, 90, 1, s.typewriterLinePosition ?? 35, '%', (v) => {
		s.typewriterLinePosition = v;
		plugin.refreshTypewriterMode();
	}, () => void plugin.saveData(s));

	// ── Dimming toggle ────────────────────────────────────────────────────────
	const dimRow = pop.createDiv({ cls: 'sg-tw-pop-row' });
	dimRow.createSpan({ cls: 'sg-tw-pop-label', text: 'Focus dimming' });
	const dimRight = dimRow.createDiv({ cls: 'sg-tw-pop-slider-wrap sg-tw-pop-check-wrap' });
	const dimCb = dimRight.createEl('input', { type: 'checkbox' });
	dimCb.checked = s.typewriterDimming ?? true;
	dimCb.setAttribute('aria-label', 'Enable focus dimming');
	dimCb.addEventListener('change', () => {
		s.typewriterDimming = dimCb.checked;
		void plugin.saveData(s);
		plugin.refreshTypewriterMode();
		// Re-open so dim-specific sliders appear/disappear
		pop.remove();
		showTypewriterPopover(anchor, plugin);
	});

	// ── Dim-specific sliders (only when dimming is on) ────────────────────────
	if (s.typewriterDimming !== false) {
		addSlider(pop, 'Dim strength', 10, 90, 5, s.typewriterDimStrength ?? 60, '%', (v) => {
			s.typewriterDimStrength = v;
			plugin.refreshTypewriterMode();
		}, () => void plugin.saveData(s));
		addSlider(pop, 'Solid rows', 1, 5, 1, s.typewriterSolidRows ?? 1, '', (v) => {
			// Read live through a closure by the dimming extension — no refresh needed
			s.typewriterSolidRows = v;
		}, () => void plugin.saveData(s));
	}

	// ── Position above the anchor ─────────────────────────────────────────────
	// First pass: measure at default position to get popover height
	pop.style.visibility = 'hidden';
	const ar = anchor.getBoundingClientRect();
	const pr = pop.getBoundingClientRect();
	const top = ar.top - pr.height - 6;
	const left = Math.min(ar.right - pr.width, window.innerWidth - pr.width - 8);
	pop.style.top = `${Math.max(8, top)}px`;
	pop.style.left = `${Math.max(8, left)}px`;
	pop.style.visibility = '';

	// ── Close on outside click ────────────────────────────────────────────────
	const close = (e: MouseEvent) => {
		if (!pop.contains(e.target as Node) && e.target !== anchor) {
			pop.remove();
			document.removeEventListener('mousedown', close, true);
		}
	};
	setTimeout(() => document.addEventListener('mousedown', close, true), 0);
}

function addSlider(
	parent: HTMLElement, label: string, min: number, max: number, step: number,
	value: number, unit: string, onChange: (v: number) => void, onCommit?: () => void
): void {
	const row = parent.createDiv({ cls: 'sg-tw-pop-row' });
	row.createSpan({ cls: 'sg-tw-pop-label', text: label });
	const right = row.createDiv({ cls: 'sg-tw-pop-slider-wrap' });
	const slider = right.createEl('input', { type: 'range', cls: 'sg-tw-pop-slider' });
	slider.min = String(min);
	slider.max = String(max);
	slider.step = String(step);
	slider.value = String(value);
	const display = right.createSpan({ cls: 'sg-tw-pop-val', text: `${value}${unit}` });
	slider.addEventListener('input', () => {
		const v = parseInt(slider.value, 10);
		display.textContent = `${v}${unit}`;
		onChange(v);
	});
	// Persist to disk only when the drag ends, not on every tick
	if (onCommit) slider.addEventListener('change', onCommit);
}
