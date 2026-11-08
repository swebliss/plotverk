import { App, Menu, SuggestModal, TFile } from 'obsidian';
import { TodoItem, TaskLink, generateId } from '../grid-data';
import { setPhosphorIcon } from '../utils/icons';
import { isSafetyNetPath } from '../utils/safety-paths';
import { isOverdue, isDueToday, sortTasks, formatDue, reorderTasks, moveTaskToEnd, subtaskProgress, applySubtaskRollup } from '../utils/tasks';
import { getLocale, t } from '../i18n';

export interface TaskListRenderOptions {
	/** The element this module renders into (cleared each call). */
	container: HTMLElement;
	/** Live todos array — mutated in-place, then `save` is called. */
	todos: TodoItem[];
	/** Persist the mutation to storage. */
	save: () => void;
	/** Trigger a full re-render of the parent view. */
	rerender: () => void;
	/** Sidebar compact mode — caps open/done counts and uses tighter spacing. */
	compact?: boolean;
	/** Section title. Defaults to 'To-do'. */
	title?: string;
	/** Obsidian App — enables the date picker, priority selector, and story link affordance. */
	app?: App;
	/** Cap on visible active tasks (sidebar). Defaults to 5 when compact, unlimited otherwise. */
	maxOpen?: number;
	/** Sort active tasks by urgency (overdue → today → priority). Default true. */
	sortByUrgency?: boolean;
	/** Show the Completed group. Default true. */
	showCompleted?: boolean;
	/** Auto-complete a parent when its last subtask is checked (and undo that). Default true. */
	subtaskRollup?: boolean;
	/**
	 * Called when the user drags to reorder while urgency-sorted.
	 * The parent view should switch to manual sort in response.
	 */
	onSwitchToManualSort?: () => void;
}

/**
 * Shared to-do list controller used by both the Dashboard and the
 * Writers Panel's Progress tab. Owns all transient UI state so each view
 * just holds one instance and calls render() on every redraw.
 */
export class TaskListController {
	private _expandedTodos: Set<string> = new Set();
	private _focusSubtaskFor: string | null = null;
	private _editingTodoId: string | null = null;
	private _editingSubtaskId: string | null = null;
	private _scrollToTodoId: string | null = null;
	private _draggingTodoId: string | null = null;
	/**
	 * Where the dragged row will land: id of the row it sits before, null for the
	 * end of the list, undefined until the first dragover (i.e. nothing moved).
	 */
	private _dropBeforeId: string | null | undefined = undefined;
	private _showTodoInput = false;
	private _pendingUndo: { item: TodoItem; idx: number; timer: number } | null = null;
	private _completedExpanded = false;
	/** Snapshot of the last render options — used by refreshRow to rebuild a single row. */
	private _lastOpts: TaskListRenderOptions | null = null;
	/** Map from todo id → its rendered wrap element, for targeted single-row refresh. */
	private _rowEls: Map<string, HTMLElement> = new Map();

	/**
	 * Re-render only the single row for todoId without touching the rest of the view.
	 * Falls back to a full rerender() if the row element is no longer in the DOM.
	 */
	private refreshRow(todoId: string): void {
		if (!this._lastOpts) return;
		const { todos, save, rerender, app, sortByUrgency = true, subtaskRollup = true, onSwitchToManualSort } = this._lastOpts;
		const todo = todos.find((t) => t.id === todoId);
		const oldWrap = this._rowEls.get(todoId);
		if (!todo || !oldWrap?.isConnected || !oldWrap.parentElement) {
			rerender();
			return;
		}
		const parent = oldWrap.parentElement;
		const nextSibling = oldWrap.nextSibling;
		this._rowEls.delete(todoId);
		oldWrap.remove();
		const newWrap = this.buildRow(todo, todos, save, rerender, app, sortByUrgency, subtaskRollup, onSwitchToManualSort);
		this._rowEls.set(todoId, newWrap);
		parent.insertBefore(newWrap, nextSibling);
	}

	render(opts: TaskListRenderOptions): void {
		this._lastOpts = opts;
		this._rowEls.clear();

		const {
			container, todos, save, rerender, compact = false, title = t('taskList.defaultTitle'), app,
			maxOpen, sortByUrgency = true, showCompleted = true, subtaskRollup = true, onSwitchToManualSort,
		} = opts;
		const MAX_OPEN = maxOpen ?? (compact ? 5 : Infinity);
		const MAX_DONE = compact ? 3 : Infinity;

		container.empty();

		// ── Header ──────────────────────────────────────────────────────────────
		const head = container.createDiv({ cls: 'sg-todo-head' });
		const headLeft = head.createDiv({ cls: 'sg-todo-head-left' });
		setPhosphorIcon(headLeft.createSpan({ cls: 'sg-todo-head-icon' }), 'note-pencil', '✅');
		headLeft.createSpan({ cls: 'sg-todo-head-title', text: title });
		const addBtn = head.createEl('button', { cls: 'sg-todo-add-btn' });
		setPhosphorIcon(addBtn, 'plus-bold', '+');
		addBtn.setAttribute('aria-label', t('taskList.addTaskAria'));
		addBtn.addEventListener('click', () => { this._showTodoInput = true; rerender(); });

		// ── List ────────────────────────────────────────────────────────────────
		const list = container.createDiv({ cls: 'sg-todo-list' });

		if (this._showTodoInput) {
			const inputRow = list.createDiv({ cls: 'sg-todo-input-row' });
			const taskInput = inputRow.createEl('input', { cls: 'sg-todo-input', type: 'text' });
			taskInput.placeholder = t('taskList.newTaskPlaceholder');
			window.setTimeout(() => taskInput.focus(), 0);
			const commit = () => {
				const text = taskInput.value.trim();
				if (text) {
					const id = generateId();
					todos.unshift({ id, text, done: false, createdAt: new Date().toISOString() });
					// In the Writers Panel the list sits below the writing field —
					// without this the fresh task lands out of sight.
					this._scrollToTodoId = id;
				}
				this._showTodoInput = false;
				save();
				rerender();
			};
			taskInput.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') commit();
				if (e.key === 'Escape') { this._showTodoInput = false; rerender(); }
			});
			taskInput.addEventListener('blur', () => {
				window.setTimeout(() => { if (this._showTodoInput) commit(); }, 150);
			});
		}

		const openTodos = todos.filter((t) => !t.done);
		const doneTodos = todos.filter((t) => t.done);

		if (openTodos.length === 0 && doneTodos.length === 0 && !this._showTodoInput) {
			list.createDiv({ cls: 'sg-todo-empty', text: t('taskList.emptyState') });
		}

		// Lazy-assign order to todos missing it when in manual mode, so drag-reorder has stable anchors.
		if (!sortByUrgency) openTodos.forEach((t, i) => { if (t.order === undefined) t.order = i; });

		const sortedOpen = sortByUrgency
			? sortTasks(openTodos)
			: [...openTodos].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
		const visibleOpen = isFinite(MAX_OPEN) ? sortedOpen.slice(0, MAX_OPEN) : sortedOpen;
		const overflow = compact && openTodos.length > MAX_OPEN ? openTodos.length - MAX_OPEN : 0;

		for (const todo of visibleOpen) {
			const wrap = this.buildRow(todo, todos, save, rerender, app, sortByUrgency, subtaskRollup, onSwitchToManualSort);
			wrap.draggable = true;
			this._rowEls.set(todo.id, wrap);
			list.appendChild(wrap);

			// ── Per-item drag events ─────────────────────────────────────────────
			wrap.addEventListener('dragstart', (e) => {
				this._draggingTodoId = todo.id;
				this._dropBeforeId = undefined;
				e.dataTransfer?.setData('sg-todo-id', todo.id);
				if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';

				// Build a clean minimal ghost — prevents the browser capturing surrounding elements.
				const ghost = document.createElement('div');
				ghost.textContent = todo.text;
				Object.assign(ghost.style, {
					position: 'fixed', top: '-9999px', left: '-9999px',
					width: wrap.offsetWidth + 'px',
					padding: '6px 10px',
					background: 'var(--background-primary)',
					border: '1px dashed var(--interactive-accent)',
					borderRadius: '6px',
					color: 'var(--text-normal)',
					fontSize: '13px',
					opacity: '0.9',
					pointerEvents: 'none',
					boxSizing: 'border-box',
				});
				document.body.appendChild(ghost);
				e.dataTransfer?.setDragImage(ghost, e.offsetX || 20, e.offsetY || 12);
				setTimeout(() => {
					if (document.body.contains(ghost)) document.body.removeChild(ghost);
					wrap.addClass('is-dragging');
				}, 0);
			});
			wrap.addEventListener('dragend', () => {
				wrap.removeClass('is-dragging');
				this._draggingTodoId = null;
				const dropBeforeId = this._dropBeforeId;
				this._dropBeforeId = undefined;
				// If trashed, skip reorder — trash drop already saved+rerendered.
				if (!todos.find((t) => t.id === todo.id)) return;
				// Never entered the list, so there is no drop position to apply.
				if (dropBeforeId === undefined) return;
				// Reorder by id, not by DOM order — in compact mode most rows aren't
				// rendered at all, and reading them back would flatten them to order 0.
				if (dropBeforeId === null) moveTaskToEnd(todos, todo.id);
				else reorderTasks(todos, todo.id, dropBeforeId);
				if (sortByUrgency) onSwitchToManualSort?.();
				save();
				// Short pause lets the opacity transition play before the DOM is rebuilt.
				window.setTimeout(() => rerender(), 140);
			});
		}

		if (this._scrollToTodoId) {
			const target = this._rowEls.get(this._scrollToTodoId);
			this._scrollToTodoId = null;
			if (target) window.setTimeout(() => target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
		}

		// ── Container-level drag: live-insert dragging item by cursor position ───
		list.addEventListener('dragover', (e: DragEvent) => {
			e.preventDefault();
			const dragging = list.querySelector<HTMLElement>('.sg-todo-wrap.is-dragging');
			if (!dragging) return;
			const doneGroup = list.querySelector<HTMLElement>('.sg-todo-done-group');
			const siblings = [...list.querySelectorAll<HTMLElement>(':scope > .sg-todo-wrap:not(.is-dragging)')];
			const next = siblings.find((sib) => {
				const r = sib.getBoundingClientRect();
				return e.clientY <= r.top + r.height / 2;
			});
			this._dropBeforeId = next?.dataset.todoId ?? null;
			list.insertBefore(dragging, next ?? doneGroup ?? null);
		});
		list.addEventListener('dragenter', (e: DragEvent) => e.preventDefault());

		if (overflow > 0) {
			list.createDiv({ cls: 'sg-todo-overflow', text: t('taskList.overflow.more', { count: overflow }) });
		}

		// ── Completed group (collapsible) ────────────────────────────────────────
		if (showCompleted && doneTodos.length > 0) {
			const doneGroup = list.createDiv({ cls: 'sg-todo-done-group' });

			const doneToggle = doneGroup.createEl('button', { cls: 'sg-todo-done-toggle' });
			setPhosphorIcon(
				doneToggle.createSpan({ cls: 'sg-todo-done-caret' }),
				this._completedExpanded ? 'caret-down' : 'caret-right',
				this._completedExpanded ? '▾' : '▸',
			);
			doneToggle.createSpan({ cls: 'sg-todo-done-label', text: t('taskList.completedLabel', { count: doneTodos.length }) });
			doneToggle.addEventListener('click', () => {
				this._completedExpanded = !this._completedExpanded;
				rerender();
			});

			if (this._completedExpanded) {
				const clearBtn = doneGroup.createEl('button', { cls: 'sg-todo-clear-btn', text: t('taskList.clearAll') });
				clearBtn.setAttribute('aria-label', t('taskList.clearAllAria'));
				clearBtn.addEventListener('click', () => {
					for (let i = todos.length - 1; i >= 0; i--) {
						if (todos[i].done) todos.splice(i, 1);
					}
					this._completedExpanded = false;
					save();
					rerender();
				});

				const visibleDone = compact ? doneTodos.slice(0, MAX_DONE) : doneTodos;
				for (const todo of visibleDone) {
					const wrap = this.buildRow(todo, todos, save, rerender, app, sortByUrgency, subtaskRollup, onSwitchToManualSort);
					this._rowEls.set(todo.id, wrap);
					doneGroup.appendChild(wrap);
				}

				if (compact && doneTodos.length > MAX_DONE) {
					doneGroup.createDiv({
						cls: 'sg-todo-overflow',
						text: t('taskList.overflow.more', { count: doneTodos.length - MAX_DONE }),
					});
				}
			}
		}

		// ── Trash drop zone ──────────────────────────────────────────────────────
		const trash = container.createDiv({ cls: 'sg-todo-trash' });
		setPhosphorIcon(trash.createSpan({ cls: 'sg-todo-trash-icon' }), 'trash', '🗑');
		trash.createSpan({ text: t('taskList.trash.label') });
		trash.addEventListener('dragover', (e) => { e.preventDefault(); trash.addClass('is-over'); });
		trash.addEventListener('dragleave', () => trash.removeClass('is-over'));
		trash.addEventListener('drop', (e) => {
			e.preventDefault();
			trash.removeClass('is-over');
			const id = e.dataTransfer?.getData('sg-todo-id');
			const idx = todos.findIndex((t) => t.id === id);
			if (idx >= 0) {
				const [removed] = todos.splice(idx, 1);
				if (this._pendingUndo) window.clearTimeout(this._pendingUndo.timer);
				this._pendingUndo = {
					item: removed, idx,
					timer: window.setTimeout(() => { this._pendingUndo = null; }, 4000),
				};
				save();
				rerender();
			}
		});

		// ── Undo toast ───────────────────────────────────────────────────────────
		if (this._pendingUndo) {
			const toast = container.createDiv({ cls: 'sg-todo-toast' });
			toast.createSpan({ text: t('taskList.undo.taskDeleted') });
			const undoBtn = toast.createEl('button', { cls: 'sg-todo-undo-btn', text: t('taskList.undo.button') });
			undoBtn.addEventListener('click', () => {
				if (this._pendingUndo) {
					window.clearTimeout(this._pendingUndo.timer);
					todos.splice(this._pendingUndo.idx, 0, this._pendingUndo.item);
					this._pendingUndo = null;
					save();
					rerender();
				}
			});
		}
	}

	private buildRow(
		todo: TodoItem,
		todos: TodoItem[],
		save: () => void,
		rerender: () => void,
		app?: App,
		sortByUrgency?: boolean,
		subtaskRollup?: boolean,
		onSwitchToManualSort?: () => void,
	): HTMLElement {
		if (!todo.subtasks) todo.subtasks = [];
		const subtasks = todo.subtasks;
		const isExpanded = this._expandedTodos.has(todo.id);
		const hasSubtasks = subtasks.length > 0;
		const { done: doneCount, total: totalCount } = subtaskProgress(todo);
		const isEditingText = this._editingTodoId === todo.id;

		const wrap = document.createElement('div');
		wrap.addClass('sg-todo-wrap');
		wrap.dataset.todoId = todo.id;

		// ── Main task row ────────────────────────────────────────────────────────
		const row = wrap.createDiv({
			cls: 'sg-todo-row' + (todo.done ? ' is-done' : '') + (hasSubtasks ? ' has-subtasks' : ''),
		});

		// Forward reference — subWrap is built below and captured in doToggle closure
		let subWrap: HTMLElement | null = null;

		// Fold/unfold toggle — manipulates DOM directly so the CSS transition can play (no rerender)
		const toggle = row.createSpan({ cls: 'sg-todo-toggle' });
		if (hasSubtasks) {
			setPhosphorIcon(toggle, isExpanded ? 'caret-down' : 'caret-right', isExpanded ? '▾' : '▸');
			toggle.addClass('is-active');
			toggle.setAttribute('role', 'button');
			toggle.setAttribute('tabindex', '0');
			toggle.setAttribute('aria-label', isExpanded ? t('taskList.subtasks.collapseAria') : t('taskList.subtasks.expandAria'));
			const doToggle = (e: Event) => {
				e.stopPropagation();
				const nowExpanded = this._expandedTodos.has(todo.id);
				if (nowExpanded) {
					this._expandedTodos.delete(todo.id);
					subWrap?.removeClass('is-open');
					toggle.empty();
					setPhosphorIcon(toggle, 'caret-right', '▸');
					toggle.setAttribute('aria-label', t('taskList.subtasks.expandAria'));
				} else {
					this._expandedTodos.add(todo.id);
					subWrap?.addClass('is-open');
					toggle.empty();
					setPhosphorIcon(toggle, 'caret-down', '▾');
					toggle.setAttribute('aria-label', t('taskList.subtasks.collapseAria'));
				}
			};
			toggle.addEventListener('click', doToggle);
			toggle.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') doToggle(e); });
		}

		// Checkbox — structural change (moves row between lists), always full rerender
		const check = row.createEl('input', { type: 'checkbox' });
		check.id = `sg-todo-check-${todo.id}`;
		check.setAttribute('aria-label', truncateForLabel(todo.text));
		check.checked = todo.done;
		check.addEventListener('change', () => {
			todo.done = check.checked;
			if (todo.done) todo.completedAt = new Date().toISOString();
			else delete todo.completedAt;
			save();
			rerender();
		});

		// Text — edit-in-place on double-click
		if (isEditingText) {
			const editInput = row.createEl('input', { cls: 'sg-todo-text-edit', type: 'text' });
			editInput.value = todo.text;
			window.setTimeout(() => { editInput.focus(); editInput.select(); }, 0);
			const commitEdit = () => {
				const newText = editInput.value.trim();
				if (newText) todo.text = newText;
				this._editingTodoId = null;
				save();
				this.refreshRow(todo.id);
			};
			editInput.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') { e.stopPropagation(); commitEdit(); }
				if (e.key === 'Escape') { this._editingTodoId = null; this.refreshRow(todo.id); }
			});
			editInput.addEventListener('blur', () => {
				window.setTimeout(() => { if (this._editingTodoId === todo.id) commitEdit(); }, 150);
			});
		} else {
			const textSpan = row.createSpan({ cls: 'sg-todo-text', text: todo.text });
			textSpan.title = t('taskList.row.editHintTitle');
			textSpan.addEventListener('dblclick', (e) => {
				e.stopPropagation();
				this._editingTodoId = todo.id;
				this.refreshRow(todo.id);
			});
		}

		// Story link chip (always visible when set, clickable)
		if (todo.link && app) {
			const chip = row.createEl('button', { cls: 'sg-todo-link-chip', attr: { type: 'button' } });
			setPhosphorIcon(chip.createSpan({ cls: 'sg-todo-link-chip-icon' }), linkKindIcon(todo.link.kind), '↗');
			chip.createSpan({ cls: 'sg-todo-link-chip-label', text: todo.link.label });
			chip.addEventListener('click', (e) => {
				e.stopPropagation();
				app.workspace.openLinkText(todo.link!.path, '', false);
			});
			chip.setAttribute('title', t('taskList.link.openTitle', { path: todo.link.path }));
		}

		// Priority dot (skip 'normal' to avoid visual noise)
		if (todo.priority && todo.priority !== 'normal') {
			const dot = row.createSpan({ cls: 'sg-todo-priority' });
			dot.dataset.priority = todo.priority;
			dot.setAttribute('aria-label', t('taskList.priority.aria', { priority: t('taskList.priority.value.' + todo.priority) }));
		}

		// Due date pill — targeted refresh on change (no full rerender)
		if (todo.due) {
			const overdue = isOverdue(todo);
			const today = isDueToday(todo);
			const label = overdue ? t('taskList.due.overdue') : formatDue(todo.due, new Date(), getLocale());
			const pill = row.createEl('button', { cls: 'sg-todo-due', attr: { type: 'button' } });
			if (overdue) pill.addClass('is-overdue');
			else if (today) pill.addClass('is-today');
			pill.setText(label);
			pill.addEventListener('click', (e) => {
				e.stopPropagation();
				openDuePicker(pill, todo.due ?? '', (val) => {
					todo.due = val || undefined;
					save();
					this.refreshRow(todo.id);
				});
			});
		}

		// ── Inline action buttons (hover-reveal, right edge) ────────────────────
		const actions = row.createDiv({ cls: 'sg-todo-actions' });

		// Calendar — targeted refresh on change
		const calBtn = actions.createEl('button', { cls: 'sg-todo-action' });
		setPhosphorIcon(calBtn, 'calendar', '📅');
		calBtn.setAttribute('aria-label', t('taskList.due.setAria'));
		calBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			openDuePicker(calBtn, todo.due ?? '', (val) => {
				todo.due = val || undefined;
				save();
				this.refreshRow(todo.id);
			});
		});

		// Flag — quick high-priority toggle, targeted refresh
		const flagBtn = actions.createEl('button', {
			cls: 'sg-todo-action' + (todo.priority === 'high' ? ' is-flagged' : ''),
		});
		setPhosphorIcon(flagBtn, 'flag', '◆');
		flagBtn.setAttribute('aria-label', todo.priority === 'high' ? t('taskList.priority.removeHighAria') : t('taskList.priority.setHighAria'));
		flagBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			todo.priority = todo.priority === 'high' ? undefined : 'high';
			save();
			this.refreshRow(todo.id);
		});

		// Kebab — more actions
		const kebabBtn = actions.createEl('button', { cls: 'sg-todo-action' });
		setPhosphorIcon(kebabBtn, 'dots-three', '⋯');
		kebabBtn.setAttribute('aria-label', t('taskList.menu.moreActionsAria'));
		kebabBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const menu = new Menu();

			// Touch devices have no double-click — the menu is the edit path there
			menu.addItem((item) =>
				item.setTitle(t('taskList.menu.editText')).setIcon('pencil').onClick(() => {
					this._editingTodoId = todo.id;
					this.refreshRow(todo.id);
				}),
			);
			menu.addItem((item) =>
				item.setTitle(t('taskList.menu.addSubtask')).setIcon('plus').onClick(() => {
					this._expandedTodos.add(todo.id);
					this._focusSubtaskFor = todo.id;
					rerender();
				}),
			);
			menu.addSeparator();

			// Reorder — keyboard/touch-reachable alternative to the drag handler (currently
			// the only other way to reorder tasks). Recomputed from the live `todos` array
			// right now, at menu-open time, so the target ids always match what's on screen.
			const order = displayOrderFor(todo, todos, sortByUrgency);
			const posIdx = order.findIndex((t) => t.id === todo.id);
			let addedReorderItem = false;
			if (posIdx > 0) {
				menu.addItem((item) =>
					item.setTitle(t('taskList.menu.moveUp')).setIcon('arrow-up').onClick(() => {
						reorderTasks(todos, todo.id, order[posIdx - 1].id);
						if (sortByUrgency) onSwitchToManualSort?.();
						save();
						rerender();
					}),
				);
				addedReorderItem = true;
			}
			if (posIdx >= 0 && posIdx < order.length - 1) {
				menu.addItem((item) =>
					item.setTitle(t('taskList.menu.moveDown')).setIcon('arrow-down').onClick(() => {
						// reorderTasks(from, to) inserts `from` immediately before `to`, so
						// "move down one slot" targets the item AFTER the current next one —
						// falling back to moveTaskToEnd when there's nothing past it.
						const afterNext = order[posIdx + 2];
						if (afterNext) reorderTasks(todos, todo.id, afterNext.id);
						else moveTaskToEnd(todos, todo.id);
						if (sortByUrgency) onSwitchToManualSort?.();
						save();
						rerender();
					}),
				);
				addedReorderItem = true;
			}
			if (addedReorderItem) menu.addSeparator();

			menu.addItem((item) =>
				item.setTitle(t('taskList.menu.highPriority')).setChecked(todo.priority === 'high').onClick(() => {
					todo.priority = todo.priority === 'high' ? undefined : 'high';
					save();
					this.refreshRow(todo.id);
				}),
			);
			menu.addItem((item) =>
				item.setTitle(t('taskList.menu.lowPriority')).setChecked(todo.priority === 'low').onClick(() => {
					todo.priority = todo.priority === 'low' ? undefined : 'low';
					save();
					this.refreshRow(todo.id);
				}),
			);
			menu.addSeparator();

			if (app) {
				if (!todo.link) {
					menu.addItem((item) =>
						item.setTitle(t('taskList.menu.linkToDocument')).setIcon('link').onClick(() => {
							new TaskLinkModal(app, (file) => {
								todo.link = { kind: inferLinkKind(file), path: file.path, label: file.basename };
								save();
								this.refreshRow(todo.id);
							}).open();
						}),
					);
				} else {
					menu.addItem((item) =>
						item.setTitle(t('taskList.menu.removeLink')).setIcon('unlink').onClick(() => {
							delete todo.link;
							save();
							this.refreshRow(todo.id);
						}),
					);
				}
				menu.addSeparator();
			}

			menu.addItem((item) =>
				item.setTitle(t('common.delete')).setIcon('trash').onClick(() => {
					const idx = todos.findIndex((t) => t.id === todo.id);
					if (idx >= 0) {
						const [removed] = todos.splice(idx, 1);
						if (this._pendingUndo) window.clearTimeout(this._pendingUndo.timer);
						this._pendingUndo = {
							item: removed,
							idx,
							timer: window.setTimeout(() => { this._pendingUndo = null; }, 4000),
						};
						save();
						rerender();
					}
				}),
			);

			menu.showAtMouseEvent(e);
		});

		// ── Subtask panel — always in DOM when hasSubtasks; CSS grid-template-rows handles open/close ──────
		if (hasSubtasks || (isExpanded && this._focusSubtaskFor === todo.id)) {
			subWrap = wrap.createDiv({ cls: 'sg-todo-subtasks' + (isExpanded ? ' is-open' : '') });
			const subInner = subWrap.createDiv({ cls: 'sg-todo-subtasks-inner' });

			for (const sub of subtasks) {
				const isEditingSub = this._editingSubtaskId === sub.id;
				const subRow = subInner.createDiv({ cls: 'sg-todo-sub' + (sub.done ? ' is-done' : '') });
				subRow.createSpan({ cls: 'sg-todo-sub-indent' });

				const subCheck = subRow.createEl('input', { type: 'checkbox' });
				subCheck.id = `sg-todo-subcheck-${sub.id}`;
				subCheck.setAttribute('aria-label', truncateForLabel(sub.text));
				subCheck.checked = sub.done;
				subCheck.addEventListener('change', () => {
					sub.done = subCheck.checked;
					// Roll the change up to the parent (honours the taskSubtaskRollup setting).
					const parentMoved = applySubtaskRollup(todo, subtaskRollup !== false);
					save();
					if (parentMoved) rerender(); // structural: parent moves between groups
					else this.refreshRow(todo.id);
				});

				// Subtask text — edit-in-place on double-click
				if (isEditingSub) {
					const subEditInput = subRow.createEl('input', { cls: 'sg-todo-sub-text-edit', type: 'text' });
					subEditInput.value = sub.text;
					window.setTimeout(() => { subEditInput.focus(); subEditInput.select(); }, 0);
					const commitSubEdit = () => {
						const newText = subEditInput.value.trim();
						if (newText) sub.text = newText;
						this._editingSubtaskId = null;
						save();
						this.refreshRow(todo.id);
					};
					subEditInput.addEventListener('keydown', (e) => {
						if (e.key === 'Enter') { e.stopPropagation(); commitSubEdit(); }
						if (e.key === 'Escape') { this._editingSubtaskId = null; this.refreshRow(todo.id); }
					});
					subEditInput.addEventListener('blur', () => {
						window.setTimeout(() => { if (this._editingSubtaskId === sub.id) commitSubEdit(); }, 150);
					});
				} else {
					const subText = subRow.createSpan({ cls: 'sg-todo-sub-text', text: sub.text });
					subText.title = t('taskList.row.editHintTitle');
					subText.addEventListener('dblclick', (e) => {
						e.stopPropagation();
						this._editingSubtaskId = sub.id;
						this.refreshRow(todo.id);
					});
				}

				// Pencil button — the touch path to edit (no double-click on phones)
				const subEdit = subRow.createEl('button', { cls: 'sg-todo-sub-del' });
				setPhosphorIcon(subEdit, 'pencil', '✎');
				subEdit.setAttribute('aria-label', t('taskList.subtask.editAria'));
				subEdit.addEventListener('click', (e) => {
					e.stopPropagation();
					this._editingSubtaskId = sub.id;
					this.refreshRow(todo.id);
				});

				const subDel = subRow.createEl('button', { cls: 'sg-todo-sub-del' });
				setPhosphorIcon(subDel, 'x', '◆');
				subDel.setAttribute('aria-label', t('taskList.subtask.deleteAria'));
				subDel.addEventListener('click', () => {
					const i = subtasks.indexOf(sub);
					if (i >= 0) subtasks.splice(i, 1);
					save();
					rerender();
				});
			}

			if (this._focusSubtaskFor === todo.id) {
				const addRow = subInner.createDiv({ cls: 'sg-todo-sub-add' });
				addRow.createSpan({ cls: 'sg-todo-sub-indent' });
				const subInput = addRow.createEl('input', { cls: 'sg-todo-sub-input', type: 'text' });
				subInput.placeholder = t('taskList.subtask.newPlaceholder');
				window.setTimeout(() => subInput.focus(), 0);
				const commitSub = () => {
					const text = subInput.value.trim();
					if (text) subtasks.push({ id: generateId(), text, done: false });
					this._expandedTodos.add(todo.id);
					this._focusSubtaskFor = null;
					save();
					rerender();
				};
				subInput.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') commitSub();
					if (e.key === 'Escape') { this._focusSubtaskFor = null; rerender(); }
				});
				subInput.addEventListener('blur', () => {
					window.setTimeout(() => { if (this._focusSubtaskFor === todo.id) commitSub(); }, 150);
				});
			}
		}

		return wrap;
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function openDuePicker(anchor: HTMLElement, current: string, onChange: (val: string) => void): void {
	document.querySelectorAll('.sg-due-popover').forEach((el) => el.remove());

	const pop = document.body.createDiv({ cls: 'sg-due-popover' });

	const dateInp = pop.createEl('input', { cls: 'sg-due-date', type: 'date' });
	const timeInp = pop.createEl('input', { cls: 'sg-due-time', type: 'time' });

	if (current) {
		dateInp.value = current.slice(0, 10);
		timeInp.value = current.includes('T') ? current.slice(11, 16) : '';
	}

	const row = pop.createDiv({ cls: 'sg-due-row' });
	const applyBtn = row.createEl('button', { cls: 'sg-due-apply', text: t('taskList.duePicker.apply') });
	const clearBtn = row.createEl('button', { cls: 'sg-due-clear', text: t('taskList.duePicker.clear') });

	// Position below the anchor, flipping/clamping to stay on screen — mirrors
	// ColorPickerPopover.show() in ui/color-picker-popover.ts. Measured after the
	// content above is built so offsetWidth/offsetHeight reflect the real size.
	const rect = anchor.getBoundingClientRect();
	const pw = pop.offsetWidth, ph = pop.offsetHeight;
	let top = rect.bottom + 4;
	let left = rect.left;
	if (top + ph > window.innerHeight - 8) top = Math.max(8, rect.top - ph - 4);
	left = Math.min(left, window.innerWidth - pw - 8);
	left = Math.max(8, left);
	pop.style.top = `${top}px`;
	pop.style.left = `${left}px`;

	const close = () => {
		pop.remove();
		document.removeEventListener('mousedown', outside, true);
		document.removeEventListener('keydown', onKeydown, true);
	};

	applyBtn.addEventListener('click', () => {
		if (dateInp.value) {
			const val = timeInp.value ? `${dateInp.value}T${timeInp.value}` : dateInp.value;
			onChange(val);
		}
		close();
	});

	clearBtn.addEventListener('click', () => { onChange(''); close(); });

	const outside = (e: MouseEvent) => {
		if (!pop.contains(e.target as Node)) close();
	};
	const onKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') close();
	};
	window.setTimeout(() => {
		document.addEventListener('mousedown', outside, true);
		document.addEventListener('keydown', onKeydown, true);
	}, 0);
}

/** The todo's current on-screen siblings within its own group (open or done), in display order. */
function displayOrderFor(todo: TodoItem, todos: TodoItem[], sortByUrgency?: boolean): TodoItem[] {
	if (todo.done) return todos.filter((t) => t.done);
	const open = todos.filter((t) => !t.done);
	return sortByUrgency ? sortTasks(open) : [...open].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Trim long task text down to a reasonable accessible-name length for checkbox aria-labels. */
function truncateForLabel(text: string, max = 60): string {
	return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

function inferLinkKind(file: TFile): TaskLink['kind'] {
	if (file.extension === 'storygrid') return 'grid';
	if (file.path.includes('/Characters/')) return 'character';
	if (file.path.includes('/Scenes/')) return 'scene';
	return 'chapter';
}

function linkKindIcon(kind: TaskLink['kind']): string {
	const icons: Record<TaskLink['kind'], string> = {
		character: 'user',
		scene: 'scroll',
		chapter: 'book-open',
		grid: 'layout-grid',
	};
	return icons[kind] ?? 'link';
}

class TaskLinkModal extends SuggestModal<TFile> {
	private onChoose: (file: TFile) => void;

	constructor(app: App, onChoose: (file: TFile) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder(t('taskList.linkModal.placeholder'));
	}

	getSuggestions(query: string): TFile[] {
		const lower = query.toLowerCase();
		return this.app.vault.getFiles()
			.filter((f) =>
				(f.extension === 'md' || f.extension === 'storygrid') &&
				!isSafetyNetPath(f.path) &&
				f.basename.toLowerCase().includes(lower),
			)
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, 50);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.createDiv({ cls: 'sg-suggest-title', text: file.basename });
		el.createDiv({ cls: 'sg-suggest-path', text: file.path });
	}

	onChooseSuggestion(file: TFile): void {
		this.onChoose(file);
	}
}
