/**
 * Phosphor Bold icon SVG strings — the single icon source for the entire plugin.
 * Source: https://phosphoricons.com (Bold weight, 256×256 viewBox)
 *
 * ⚠️  NOTE ON OBSIDIAN MENU API:
 * Obsidian's Menu.addItem().setIcon() is an internal MenuItem method that uses
 * Lucide via Obsidian's own registry and cannot be intercepted. Those calls
 * are intentionally left unchanged in grid-view.ts. Only standalone setIcon()
 * calls on raw DOM elements have been migrated here.
 *
 * To add more icons:
 *  1. Find the Bold SVG at https://phosphoricons.com
 *  2. Add it to PHOSPHOR_ICONS below with a kebab-case key
 *  3. For scene-type icons, also add an entry to SCENE_ICON_OPTIONS
 */

import { setStaticMarkup } from './dom-html';

export const PHOSPHOR_ICONS: Record<string, string> = {

	// ── Toolbar / UI icons ───────────────────────────────────────────────────

	/** square-split-vertical Regular — "add row" (square split into top/bottom halves) */
	'rows': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M200,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,16v64H56V56Zm0,144H56V136H200v64Z"/></svg>`,

	/** squares-four — outline 2×2 grid (line style, matches globe/graph weight) */
	'squares-four': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><rect x="40" y="40" width="176" height="176" rx="16"/><line x1="128" y1="40" x2="128" y2="216"/><line x1="40" y1="128" x2="216" y2="128"/></svg>`,

	/** pen-nib Bold — Writers Panel (the writing surface) */
	'pen-nib': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M248,92.68a15.86,15.86,0,0,0-4.69-11.31L174.63,12.68a16,16,0,0,0-22.63,0L123.57,41.11l-58,21.77A16.06,16.06,0,0,0,55.35,75.23L32.11,214.68A8,8,0,0,0,40,224a8.4,8.4,0,0,0,1.32-.11l139.44-23.24a16,16,0,0,0,12.35-10.17l21.77-58L243.31,104A15.87,15.87,0,0,0,248,92.68Zm-69.87,92.19L63.32,204l47.37-47.37a28,28,0,1,0-11.32-11.32L52,192.7,71.13,77.86,126,57.29,198.7,130ZM112,132a12,12,0,1,1,12,12A12,12,0,0,1,112,132Zm96-15.32L139.31,48l24-24L232,92.68Z"/></svg>`,

	/** check-square Regular — Progress tab */
	'check-square': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM224,48V208a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32H208A16,16,0,0,1,224,48ZM208,208V48H48V208H208Z"/></svg>`,

	/** chart-bar — outline bar chart: L-axis + 3 rising bars (matches globe/graph weight) */
	'chart-bar': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="M48,40V208H216"/><line x1="92" y1="200" x2="92" y2="156" stroke-width="20"/><line x1="140" y1="200" x2="140" y2="120" stroke-width="20"/><line x1="188" y1="200" x2="188" y2="84" stroke-width="20"/></svg>`,

	/** Stopwatch — sprint timer */
	'timer': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,40a96,96,0,1,0,96,96A96.11,96.11,0,0,0,128,40Zm0,176a80,80,0,1,1,80-80A80.09,80.09,0,0,1,128,216Zm45.66-101.66a8,8,0,0,1,0,11.32l-40,40a8,8,0,0,1-11.32-11.32l40-40A8,8,0,0,1,173.66,114.34ZM96,16a8,8,0,0,1,8-8h48a8,8,0,0,1,0,16H104A8,8,0,0,1,96,16Z"/></svg>`,

	/** caret-up Bold — collapse / sort-up (caret-down rotated 180°) */
	'caret-up': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><g transform="rotate(180 128 128)"><path d="M216.49,104.49l-80,80a12,12,0,0,1-17,0l-80-80a12,12,0,0,1,17-17L128,159l71.51-71.52a12,12,0,0,1,17,17Z"/></g></svg>`,

	/** caret-left Bold — back / previous (caret-down rotated 90°) */
	'caret-left': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><g transform="rotate(90 128 128)"><path d="M216.49,104.49l-80,80a12,12,0,0,1-17,0l-80-80a12,12,0,0,1,17-17L128,159l71.51-71.52a12,12,0,0,1,17,17Z"/></g></svg>`,

	/** caret-right Bold — expand / next (caret-down rotated -90°) */
	'caret-right': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><g transform="rotate(-90 128 128)"><path d="M216.49,104.49l-80,80a12,12,0,0,1-17,0l-80-80a12,12,0,0,1,17-17L128,159l71.51-71.52a12,12,0,0,1,17,17Z"/></g></svg>`,

	/** Eye — widget visible */
	'eye': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z"/></svg>`,

	/** Eye with slash — widget hidden */
	'eye-slash': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M53.92,34.62A8,8,0,1,0,42.08,45.38L61.32,66.55C25,88.84,9.38,123.2,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208a127.11,127.11,0,0,0,52.07-10.83l21.95,24.21a8,8,0,1,0,11.84-10.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.16,133.16,0,0,1,25,128c4.69-8.79,19.66-33.39,47.35-49.38l20,22A48,48,0,0,0,154.7,164.7l13.26,14.59A112.35,112.35,0,0,1,128,192Zm-22-60a22,22,0,0,1,22-22h.3l-.3-.33a8,8,0,0,1,11.86-10.73,22,22,0,0,1-33.86,33.06Zm141.31-.74c-.35.79-8.82,19.57-27.65,38.4-1.6,1.6-3.26,3.13-5,4.61L207.93,158a133.16,133.16,0,0,0,23.12-30C223.84,114.54,192.43,64,128,64a118.05,118.05,0,0,0-19.83,1.65L93.27,49.22A133.91,133.91,0,0,1,128,48c34.88,0,66.57,13.26,91.66,38.35,18.83,18.83,27.3,37.62,27.65,38.41A8,8,0,0,1,247.31,131.26Z"/></svg>`,

	/** Two circular arrows — refresh / regenerate */
	'arrows-clockwise': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M240,56v48a8,8,0,0,1-8,8H184a8,8,0,0,1,0-16h28.69L186.06,69.37a79.56,79.56,0,0,0-56.13-23.43h-.45A79.52,79.52,0,0,0,73.75,68.84a8,8,0,0,1-11.16-11.47A96,96,0,0,1,196.59,57.94a.85.85,0,0,1,.07.07L224,85.6V56a8,8,0,0,1,16,0ZM182.25,187.16a80,80,0,0,1-112.79-.66L42.83,159.94l28.79.06a8,8,0,0,0,0-16H24a8,8,0,0,0-8,8v48a8,8,0,0,0,16,0V170.45l27.18,27.18A96,96,0,0,0,193.41,198.6a8,8,0,0,0-11.16-11.44Z"/></svg>`,

	/** Hourglass Bold — an era (Timeline: Add era, era sheets in the Codex) */
	'hourglass': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M204,75.64V40a20,20,0,0,0-20-20H72A20,20,0,0,0,52,40V76a20.1,20.1,0,0,0,8,16l48,36L60,164a20.1,20.1,0,0,0-8,16v36a20,20,0,0,0,20,20H184a20,20,0,0,0,20-20V180.36a20.13,20.13,0,0,0-7.94-16L147.9,128l48.16-36.4A20.13,20.13,0,0,0,204,75.64ZM180,212H76V182l52-39,52,39.33Zm0-138.35L128,113,76,74V44H180Z"/></svg>`,

	/** Calendar — dates / due */
	// Timeline icon (Emma's pick 2026-11-06: a dot on a line, like the Timeline's event badges)
	'git-commit': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M244,116H186.79a60,60,0,0,0-117.58,0H12a12,12,0,0,0,0,24H69.21a60,60,0,0,0,117.58,0H244a12,12,0,0,0,0-24ZM128,164a36,36,0,1,1,36-36A36,36,0,0,1,128,164Z"/></svg>`,
	'calendar': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M208,32H184V24a8,8,0,0,0-16,0v8H88V24a8,8,0,0,0-16,0v8H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32Zm0,176H48V96H208V208Zm0-128H48V48H72v8a8,8,0,0,0,16,0V48h80v8a8,8,0,0,0,16,0V48h24Z"/></svg>`,

	/** Six dots in two columns — drag handle */
	'dots-six-vertical': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M108,60A16,16,0,1,1,92,44,16,16,0,0,1,108,60Zm56,16a16,16,0,1,0-16-16A16,16,0,0,0,164,76ZM92,112a16,16,0,1,0,16,16A16,16,0,0,0,92,112Zm72,0a16,16,0,1,0,16,16A16,16,0,0,0,164,112ZM92,180a16,16,0,1,0,16,16A16,16,0,0,0,92,180Zm72,0a16,16,0,1,0,16,16A16,16,0,0,0,164,180Z"/></svg>`,

	/** Three stacked lines — list view */
	'list': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M216,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H208A8,8,0,0,1,216,128ZM40,72H208a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16ZM208,184H40a8,8,0,0,0,0,16H208a8,8,0,0,0,0-16Z"/></svg>`,

	/** Cross — close / clear */
	'x': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>`,

	/** square-split-horizontal Regular — "add column" (square split into left/right halves) */
	'columns': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M200,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40ZM56,56h64V200H56ZM200,200H136V56h64V200Z"/></svg>`,

	/** Horizontal bar — zoom out / remove */
	'corners-out': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M220,48V88a12,12,0,0,1-24,0V60H168a12,12,0,0,1,0-24h40A12,12,0,0,1,220,48ZM88,196H60V168a12,12,0,0,0-24,0v40a12,12,0,0,0,12,12H88a12,12,0,0,0,0-24Zm120-40a12,12,0,0,0-12,12v28H168a12,12,0,0,0,0,24h40a12,12,0,0,0,12-12V168A12,12,0,0,0,208,156ZM88,36H48A12,12,0,0,0,36,48V88a12,12,0,0,0,24,0V60H88a12,12,0,0,0,0-24Z"/></svg>`,
	'minus': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M224,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128Z"/></svg>`,

	/** Cross — zoom in / add (Regular weight, 16 px arms) */
	'plus': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"/></svg>`,

	/** Cross — Bold weight, 24 px arms; use for prominent header + buttons */
	'plus-bold': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M224,128a12,12,0,0,1-12,12H140v84a12,12,0,0,1-24,0V140H32a12,12,0,0,1,0-24h84V32a12,12,0,0,1,24,0v84h84A12,12,0,0,1,224,128Z"/></svg>`,

	/** Floppy disk — save layout */
	'floppy-disk': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M219.31,72,184,36.69A15.86,15.86,0,0,0,172.69,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V83.31A15.86,15.86,0,0,0,219.31,72ZM168,208H88V152h80Zm40,0H184V152a16,16,0,0,0-16-16H88a16,16,0,0,0-16,16v56H48V48H172.69L208,83.31ZM160,72a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h56A8,8,0,0,1,160,72Z"/></svg>`,

	/** Person with plus — create character document */
	'user-plus': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M256,136a8,8,0,0,1-8,8H232v16a8,8,0,0,1-16,0V144H200a8,8,0,0,1,0-16h16V112a8,8,0,0,1,16,0v16h16A8,8,0,0,1,256,136Zm-57.87,58.85a8,8,0,0,1-12.26,10.3C165.75,181.19,138.09,168,108,168s-57.75,13.19-77.87,37.15a8,8,0,0,1-12.25-10.3c14.94-17.78,33.52-30.41,54.17-37.17a68,68,0,1,1,71.9,0C164.6,164.44,183.18,177.07,198.13,194.85ZM108,152a52,52,0,1,0-52-52A52.06,52.06,0,0,0,108,152Z"/></svg>`,

	/** Film script — create scene document */
	'film-script': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M200,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V40A16,16,0,0,0,200,24Zm0,192H56V40H200V216ZM96,76A12,12,0,1,1,84,64,12,12,0,0,1,96,76Zm0,104a12,12,0,1,1-12-12A12,12,0,0,1,96,180Zm0-52a12,12,0,1,1-12-12A12,12,0,0,1,96,128Z"/></svg>`,

	/** Note with pencil — Bold weight, thick fills readable at 16px */
	'note-pencil': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,58.34l-32-32a8,8,0,0,0-11.32,0L93.66,119A15.89,15.89,0,0,0,89.37,130L88,160a8,8,0,0,0,8,8.42A8.13,8.13,0,0,0,96.42,168L128,166.63A16,16,0,0,0,139,162.34l92.68-92.68A8,8,0,0,0,229.66,58.34ZM124.69,150.63,107.37,152l1.37-17.31L192,51.31,204.69,64ZM216,124a8,8,0,0,0-8,8v76H48V56h84a8,8,0,0,0,0-16H48A16,16,0,0,0,32,56V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V132A8,8,0,0,0,216,124Z"/></svg>`,

	/** Teardrop pin — create location document */
	'map-pin': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,64a40,40,0,1,0,40,40A40,40,0,0,0,128,64Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,128Zm0-112a88.1,88.1,0,0,0-88,88c0,31.4,14.51,64.68,42,96.25a254.19,254.19,0,0,0,41.45,38.3,8,8,0,0,0,9.18,0A254.19,254.19,0,0,0,174,200.25c27.45-31.57,42-64.85,42-96.25A88.1,88.1,0,0,0,128,16Zm0,206c-16.53-13-72-60.75-72-118a72,72,0,0,1,144,0C200,161.23,144.53,209,128,222Z"/></svg>`,

	/** Circle with plus — create new grid */
	'plus-circle': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm52,120H140v40a12,12,0,0,1-24,0V140H76a12,12,0,0,1,0-24h40V76a12,12,0,0,1,24,0v40h40a12,12,0,0,1,0,24Z"/></svg>`,

	/** Bin / rubbish — delete */
	'trash': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a12,12,0,0,0,0,24h4V208a16,16,0,0,0,16,16H196a16,16,0,0,0,16-16V72h4a12,12,0,0,0,0-24ZM104,40h48v8H104Zm88,168H64V72H192ZM112,104v64a12,12,0,0,1-24,0V104a12,12,0,0,1,24,0Zm56,0v64a12,12,0,0,1-24,0V104a12,12,0,0,1,24,0Z"/></svg>`,

	/** Single person — characters section */
	'user': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z"/></svg>`,

	/** Banner flag — factions section */
	'flag': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M42.76,50.45a8,8,0,0,0-2.76,6V216a8,8,0,0,0,16,0V171.77c26.79-21.16,49.87-9.75,76.45,3.41,16.4,8.11,34.06,16.85,53,16.85,13.93,0,28.54-4.75,43.82-18a8,8,0,0,0,2.76-6V56a8,8,0,0,0-13.27-6c-28,24.23-51.72,12.49-79.21-1.12C111.07,34.76,78.78,18.79,42.76,50.45ZM216,164.25c-26.79,21.16-49.87,9.74-76.45-3.41-25-12.35-52.81-26.13-83.55-8.4V60.1c26.79-21.16,49.87-9.75,76.45,3.4,25,12.35,52.82,26.13,83.55,8.4Z"/></svg>`,

	/** Four-point sparkle — systems / magic section */
	'sparkles': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M208,144a15.78,15.78,0,0,1-10.42,14.94l-51.65,19-19,51.61a15.92,15.92,0,0,1-29.88,0L78,178l-51.62-19a15.92,15.92,0,0,1,0-29.88l51.65-19,19-51.61a15.92,15.92,0,0,1,29.88,0l19,51.65,51.61,19A15.78,15.78,0,0,1,208,144ZM152,48h16V64a8,8,0,0,0,16,0V48h16a8,8,0,0,0,0-16H184V16a8,8,0,0,0-16,0V32H152a8,8,0,0,0,0,16Zm88,32h-8V72a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16h8v8a8,8,0,0,0,16,0V96h8a8,8,0,0,0,0-16Z"/></svg>`,

	/** Faceted gem — items / artifacts section */
	'gem': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M246,98.73l-56-64A8,8,0,0,0,184,32H72a8,8,0,0,0-6,2.73l-56,64a8,8,0,0,0,.17,10.73l112,120a8,8,0,0,0,11.7,0l112-120A8,8,0,0,0,246,98.73ZM222.37,96H180L144,48h36.37ZM74.58,112l30.13,75.33L34.41,112Zm106.84,0h40.17l-70.3,75.33ZM75.63,48H112L76,96H33.63Zm87.6,64L128,200.09,92.77,112ZM96,96l32-42.67L160,96Z"/></svg>`,

	/** Ringed planet (stroked) — World tab, Codex links, all worldbuilding entry points */
	'planet': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><circle cx="128" cy="128" r="88" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M184.76,60.75c27.13-7.21,47.41-6.45,53.44,3.94,11,18.93-29.45,62.61-90.32,97.58s-119.1,48-130.08,29c-6.05-10.43,3.51-28.37,23.49-48.23" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`,

	/** Globe (filled, with horizon swoosh) — Codex everywhere */
	'globe': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,16a87.5,87.5,0,0,1,48,14.28V74L153.83,99.74,122.36,104l-.31-.22L102.38,90.92A16,16,0,0,0,79.87,95.1L58.93,126.4a16,16,0,0,0-2.7,8.81L56,171.44l-3.27,2.15A88,88,0,0,1,128,40ZM62.29,186.47l2.52-1.65A16,16,0,0,0,72,171.53l.21-36.23L93.17,104a3.62,3.62,0,0,0,.32.22l19.67,12.87a15.94,15.94,0,0,0,11.35,2.77L156,115.59a16,16,0,0,0,10-5.41l22.17-25.76A16,16,0,0,0,192,74V67.67A87.87,87.87,0,0,1,211.77,155l-16.14-14.76a16,16,0,0,0-16.93-3l-30.46,12.65a16.08,16.08,0,0,0-9.68,12.45l-2.39,16.19a16,16,0,0,0,11.77,17.81L169.4,202l2.36,2.37A87.88,87.88,0,0,1,62.29,186.47ZM185,195l-4.3-4.31a16,16,0,0,0-7.26-4.18L152,180.85l2.39-16.19L184.84,152,205,170.48A88.43,88.43,0,0,1,185,195Z"/></svg>`,

	/** Stacked books — Codex */
	'books': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M233.6,195.61,185.07,28.45A16.06,16.06,0,0,0,165.22,17.6l-30.74,8.93a16,16,0,0,0-3.28,1.39A16,16,0,0,0,120,16H88a15.86,15.86,0,0,0-8,2.16A15.86,15.86,0,0,0,72,16H40A16,16,0,0,0,24,32V224a16,16,0,0,0,16,16H72a15.86,15.86,0,0,0,8-2.16A15.86,15.86,0,0,0,88,240h32a16,16,0,0,0,16-16V108.67l29.53,101.73a16.08,16.08,0,0,0,15.33,11.55,16.48,16.48,0,0,0,4.53-.64l30.7-8.92A16,16,0,0,0,233.6,195.61ZM88,32h32V72H88Zm32,56v80H88V88ZM72,32V72H40V32Zm0,56v80H40V88ZM40,224V184H72v40Zm48,0V184h32v40Zm81.92-130.16,30.72-8.93,22.32,76.87-30.72,8.93Zm-4.46-15.37-4.46-15.38,30.72-8.93,4.47,15.38ZM216,212.42l-22.31-76.84,30.72-8.93h0l22.31,76.84Z"/></svg>`,

	/** Connected nodes — relationship map (legacy simple) */
	'graph': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M60,128 L196,60 M60,128 L196,196" stroke="currentColor" stroke-width="16" fill="none" stroke-linecap="round"/><circle cx="56" cy="128" r="30" fill="currentColor"/><circle cx="200" cy="58" r="26" fill="currentColor"/><circle cx="200" cy="198" r="26" fill="currentColor"/></svg>`,

	/** Phosphor graph U+EB58 v1.4+ — Connections Map (5-node network) */
	'graph-new': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M200,152a31.84,31.84,0,0,0-19.53,6.68l-23.11-18A31.65,31.65,0,0,0,160,128c0-.74,0-1.48-.08-2.21l13.23-4.41A32,32,0,1,0,168,104c0,.74,0,1.48.08,2.21l-13.23,4.41A32,32,0,0,0,128,96a32.59,32.59,0,0,0-5.27.44L115.89,81A32,32,0,1,0,96,88a32.59,32.59,0,0,0,5.27-.44l6.84,15.4a31.92,31.92,0,0,0-8.57,39.64L73.83,165.44a32.06,32.06,0,1,0,10.63,12l25.71-22.84a31.91,31.91,0,0,0,37.36-1.24l23.11,18A31.65,31.65,0,0,0,168,184a32,32,0,1,0,32-32Zm0-64a16,16,0,1,1-16,16A16,16,0,0,1,200,88ZM80,56A16,16,0,1,1,96,72,16,16,0,0,1,80,56ZM56,208a16,16,0,1,1,16-16A16,16,0,0,1,56,208Zm56-80a16,16,0,1,1,16,16A16,16,0,0,1,112,128Zm88,72a16,16,0,1,1,16-16A16,16,0,0,1,200,200Z"></path></svg>`,

	/** Phosphor tree-view U+EE48 — Relationship Tree (hierarchical canvas) */
	'tree-view': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M224,112a16,16,0,0,0-16-16H136V72h8a16,16,0,0,0,16-16V24a16,16,0,0,0-16-16H112A16,16,0,0,0,96,24V56a16,16,0,0,0,16,16h8V96H48a16,16,0,0,0-16,16v24H24a16,16,0,0,0-16,16v32a16,16,0,0,0,16,16H56a16,16,0,0,0,16-16V152a16,16,0,0,0-16-16H48V112H208v24h-8a16,16,0,0,0-16,16v32a16,16,0,0,0,16,16h32a16,16,0,0,0,16-16V152a16,16,0,0,0-16-16h-8Zm-168,40v32H24V152Zm56-96V24h32V56Zm96,96v32H176V152Z"></path></svg>`,

	/** Magnifying glass — search */
	'magnifying-glass': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/></svg>`,

	/** Chevron down — dropdown caret (Bold weight) */
	'caret-down': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M216.49,104.49l-80,80a12,12,0,0,1-17,0l-80-80a12,12,0,0,1,17-17L128,159l71.51-71.52a12,12,0,0,1,17,17Z"/></svg>`,

	/** Left arrow — "back" navigation (Bold weight) */
	'arrow-left': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M228,128a12,12,0,0,1-12,12H69l51.52,51.51a12,12,0,0,1-17,17l-72-72a12,12,0,0,1,0-17l72-72a12,12,0,0,1,17,17L69,116H216A12,12,0,0,1,228,128Z"/></svg>`,

	/** Three dots — overflow / more actions menu */
	'dots-three': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M156,128a28,28,0,1,1-28-28A28,28,0,0,1,156,128ZM48,100a28,28,0,1,0,28,28A28,28,0,0,0,48,100Zm160,0a28,28,0,1,0,28,28A28,28,0,0,0,208,100Z"/></svg>`,

	/** Speedometer gauge — Dashboard / progress tracking. Lucide gauge paths scaled 24→256. */
	'gauge': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" stroke="currentColor" stroke-width="16" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M128 149 L171 107"/><path d="M35.6 202.7a106.7 106.7 0 1 1 184.7 0"/></svg>`,

	/** Pencil — general writing / editing */
	'pencil': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"/></svg>`,

	/** Two horizontal sliders with offset knobs — Timeline Appearance panel (B2) */
	'gear': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,76a52,52,0,1,0,52,52A52.06,52.06,0,0,0,128,76Zm0,80a28,28,0,1,1,28-28A28,28,0,0,1,128,156Zm92-27.21v-1.58l14-17.51a12,12,0,0,0,2.23-10.59A111.75,111.75,0,0,0,225,71.89,12,12,0,0,0,215.89,66L193.61,63.5l-1.11-1.11L190,40.1A12,12,0,0,0,184.11,31a111.67,111.67,0,0,0-27.23-11.27A12,12,0,0,0,146.3,22L128.79,36h-1.58L109.7,22a12,12,0,0,0-10.59-2.23A111.75,111.75,0,0,0,71.89,31.05,12,12,0,0,0,66,40.11L63.5,62.39,62.39,63.5,40.1,66A12,12,0,0,0,31,71.89,111.67,111.67,0,0,0,19.77,99.12,12,12,0,0,0,22,109.7l14,17.51v1.58L22,146.3a12,12,0,0,0-2.23,10.59,111.75,111.75,0,0,0,11.29,27.22A12,12,0,0,0,40.11,190l22.28,2.48,1.11,1.11L66,215.9A12,12,0,0,0,71.89,225a111.67,111.67,0,0,0,27.23,11.27A12,12,0,0,0,109.7,234l17.51-14h1.58l17.51,14a12,12,0,0,0,10.59,2.23A111.75,111.75,0,0,0,184.11,225a12,12,0,0,0,5.91-9.06l2.48-22.28,1.11-1.11L215.9,190a12,12,0,0,0,9.06-5.91,111.67,111.67,0,0,0,11.27-27.23A12,12,0,0,0,234,146.3Zm-24.12-4.89a70.1,70.1,0,0,1,0,8.2,12,12,0,0,0,2.61,8.22l12.84,16.05A86.47,86.47,0,0,1,207,166.86l-20.43,2.27a12,12,0,0,0-7.65,4,69,69,0,0,1-5.8,5.8,12,12,0,0,0-4,7.65L166.86,207a86.47,86.47,0,0,1-10.49,4.35l-16.05-12.85a12,12,0,0,0-7.5-2.62c-.24,0-.48,0-.72,0a70.1,70.1,0,0,1-8.2,0,12.06,12.06,0,0,0-8.22,2.6L99.63,211.33A86.47,86.47,0,0,1,89.14,207l-2.27-20.43a12,12,0,0,0-4-7.65,69,69,0,0,1-5.8-5.8,12,12,0,0,0-7.65-4L49,166.86a86.47,86.47,0,0,1-4.35-10.49l12.84-16.05a12,12,0,0,0,2.61-8.22,70.1,70.1,0,0,1,0-8.2,12,12,0,0,0-2.61-8.22L44.67,99.63A86.47,86.47,0,0,1,49,89.14l20.43-2.27a12,12,0,0,0,7.65-4,69,69,0,0,1,5.8-5.8,12,12,0,0,0,4-7.65L89.14,49a86.47,86.47,0,0,1,10.49-4.35l16.05,12.85a12.06,12.06,0,0,0,8.22,2.6,70.1,70.1,0,0,1,8.2,0,12,12,0,0,0,8.22-2.6l16.05-12.85A86.47,86.47,0,0,1,166.86,49l2.27,20.43a12,12,0,0,0,4,7.65,69,69,0,0,1,5.8,5.8,12,12,0,0,0,7.65,4L207,89.14a86.47,86.47,0,0,1,4.35,10.49l-12.84,16.05A12,12,0,0,0,195.88,123.9Z"/></svg>`,
	'sliders-horizontal': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M40,92H70.06a36,36,0,0,0,67.88,0H216a12,12,0,0,0,0-24H137.94a36,36,0,0,0-67.88,0H40a12,12,0,0,0,0,24Zm64-24A12,12,0,1,1,92,80,12,12,0,0,1,104,68Zm112,96H201.94a36,36,0,0,0-67.88,0H40a12,12,0,0,0,0,24h94.06a36,36,0,0,0,67.88,0H216a12,12,0,0,0,0-24Zm-48,24a12,12,0,1,1,12-12A12,12,0,0,1,168,188Z"/></svg>`,

	/** Typewriter — focus / typewriter mode toggle */
	'typewriter': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M216,88H176V56a16,16,0,0,0-16-16H96A16,16,0,0,0,80,56V88H40A24,24,0,0,0,16,112v80a24,24,0,0,0,24,24H216a24,24,0,0,0,24-24V112A24,24,0,0,0,216,88ZM96,56h64V88H96ZM224,192a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V112a8,8,0,0,1,8-8H216a8,8,0,0,1,8,8Zm-120-44a12,12,0,1,1-12-12A12,12,0,0,1,104,148Zm40,0a12,12,0,1,1-12-12A12,12,0,0,1,144,148Zm40,0a12,12,0,1,1-12-12A12,12,0,0,1,184,148ZM176,180H80a8,8,0,0,1,0-16H176a8,8,0,0,1,0,16Z"/></svg>`,

	// ── Scene-type icons (card icon picker) ──────────────────────────────────
	// Add more here as the user selects them. Each key becomes the stored
	// value in SceneCard.sceneIcon and must match an entry in SCENE_ICON_OPTIONS.

	/** Open book — backstory, research, exposition */
	'book-open': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M232,48H160a40,40,0,0,0-32,16A40,40,0,0,0,96,48H24A16,16,0,0,0,8,64V192a16,16,0,0,0,16,16H96a24,24,0,0,1,24,24,8,8,0,0,0,16,0,24,24,0,0,1,24-24h72a16,16,0,0,0,16-16V64A16,16,0,0,0,232,48ZM96,192H24V64H96a24,24,0,0,1,24,24V200A39.81,39.81,0,0,0,96,192Zm136,0H160a39.81,39.81,0,0,0-24,8V88a24,24,0,0,1,24-24h72Z"/></svg>`,

	/** Notebook with ribbon bookmark — Compile tab / manuscript export */
	'book-bookmark': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><polyline points="176 32 176 128 143.99 104 112 128 112 32" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M48,216a24,24,0,0,1,24-24H208V32H72A24,24,0,0,0,48,56Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><polyline points="48 216 48 224 192 224" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`,

	/** Flame — action, conflict, turning point */
	'flame': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M201.63,97.26A76.18,76.18,0,0,0,168,24a8,8,0,0,0-8,8c0,18.12-9.27,32.36-18.27,46.17C136.06,90,130,99.79,128,112c-7.61-8.58-9.62-20.37-11.57-31.77C114.64,69.06,112.77,58,104,50A8,8,0,0,0,92,52c-6.05,11.23-8,24.59-8,36a72,72,0,0,0,136,34.31A72.59,72.59,0,0,0,201.63,97.26ZM128,208a56.07,56.07,0,0,1-56-56c0-13.18,2.54-23.62,6.28-32.22C85.34,128.4,94.2,136,104,136a8,8,0,0,0,7.79-9.67c-2.37-12.57.38-24,8.5-38.11A72.46,72.46,0,0,0,128,136a8,8,0,0,0,7.12-4.36c3-5.73,4.92-11.36,6.62-16.57C148.22,107.5,152,120,152,136A56.06,56.06,0,0,1,128,208Z"/></svg>`,

	// ── Detail-page "drives" + custom-section icons ──────────────────────────

	/** lightning Bold — Event sheet "The Event" section */
	'lightning': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M219.71,117.38a12,12,0,0,0-7.25-8.52L161.28,88.39l10.59-70.61a12,12,0,0,0-20.64-10l-112,120a12,12,0,0,0,4.31,19.33l51.18,20.47L84.13,238.22a12,12,0,0,0,20.64,10l112-120A12,12,0,0,0,219.71,117.38ZM113.6,203.55l6.27-41.77a12,12,0,0,0-7.41-12.92L68.74,131.37,142.4,52.45l-6.27,41.77a12,12,0,0,0,7.41,12.92l43.72,17.49Z"/></svg>`,

	/** waves Bold — Event sheet "Aftermath" section (ripples) */
	'waves': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M225.24,174.74a12,12,0,0,1-1.58,16.89C205.49,206.71,189.06,212,174.15,212c-19.76,0-36.86-9.29-51.88-17.44-25.06-13.62-44.86-24.37-74.61.3a12,12,0,1,1-15.32-18.48c42.25-35,75-17.23,101.39-2.92,25.06,13.61,44.86,24.37,74.61-.3A12,12,0,0,1,225.24,174.74Zm-16.9-57.59c-29.75,24.67-49.55,13.91-74.61.3-26.35-14.3-59.14-32.11-101.39,2.92a12,12,0,0,0,15.32,18.48c29.75-24.67,49.55-13.92,74.61-.3,15,8.15,32.12,17.44,51.88,17.44,14.91,0,31.34-5.29,49.51-20.36a12,12,0,0,0-15.32-18.48ZM47.66,82.84c29.75-24.67,49.55-13.92,74.61-.3,15,8.15,32.12,17.44,51.88,17.44,14.91,0,31.34-5.29,49.51-20.36a12,12,0,0,0-15.32-18.48c-29.75,24.67-49.55,13.92-74.61.3-26.35-14.3-59.14-32.11-101.39,2.93A12,12,0,1,0,47.66,82.84Z"/></svg>`,
	// Simple Phosphor-style shapes drawn for this plugin (256 viewBox, filled).

	/** Heart — a character's Want */
	'heart': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M178,40c-20.65,0-38.73,11.14-50,28.92C116.73,51.14,98.65,40,78,40a62.07,62.07,0,0,0-62,62c0,70,103.79,126.66,108.21,129a8,8,0,0,0,7.58,0C136.21,228.66,240,172,240,102A62.07,62.07,0,0,0,178,40ZM128,214.8C109.74,204.16,32,155.69,32,102A46.06,46.06,0,0,1,78,56c19.45,0,35.78,10.36,42.6,27a8,8,0,0,0,14.8,0c6.82-16.67,23.15-27,42.6-27a46.06,46.06,0,0,1,46,46C224,155.61,146.24,204.15,128,214.8Z"/></svg>`,

	/** Compass — a character's Need / direction */
	'compass': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm47.16-138.79-64,32a8,8,0,0,0-3.58,3.57l-32,64A8,8,0,0,0,86.31,187l64-32a8,8,0,0,0,3.58-3.57l32-64a8,8,0,0,0-10.73-10.73ZM140.8,140.8,98.94,161.74l20.94-41.87,41.86-20.93Z"/></svg>`,

	/** Warning triangle — a character's Flaw */
	'warning': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M236.8,188.09,149.35,36.22a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM222.93,203.8a8.5,8.5,0,0,1-7.48,4.2H40.55a8.5,8.5,0,0,1-7.48-4.2,7.59,7.59,0,0,1,0-7.72L120.52,44.21a8.75,8.75,0,0,1,15,0l87.45,151.87A7.59,7.59,0,0,1,222.93,203.8ZM120,144V104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,180Z"/></svg>`,
	/** Link (Phosphor Bold) — Story Tree: this person is also in another faction */
	'link': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M117.18,188.74a12,12,0,0,1,0,17l-5.12,5.12A58.26,58.26,0,0,1,70.6,228h0A58.62,58.62,0,0,1,29.14,127.92L63.89,93.17a58.64,58.64,0,0,1,98.56,28.11,12,12,0,1,1-23.37,5.44,34.65,34.65,0,0,0-58.22-16.58L46.11,144.89A34.62,34.62,0,0,0,70.57,204h0a34.41,34.41,0,0,0,24.49-10.14l5.11-5.12A12,12,0,0,1,117.18,188.74ZM226.83,45.17a58.65,58.65,0,0,0-82.93,0l-5.11,5.11a12,12,0,0,0,17,17l5.12-5.12a34.63,34.63,0,1,1,49,49L175.1,145.86A34.39,34.39,0,0,1,150.61,156h0a34.63,34.63,0,0,1-33.69-26.72,12,12,0,0,0-23.38,5.44A58.64,58.64,0,0,0,150.56,180h.05a58.28,58.28,0,0,0,41.47-17.17l34.75-34.75a58.62,58.62,0,0,0,0-82.91Z"/></svg>`,
	/** Tree structure (Phosphor Bold) — Codex: "View family tree" on a Bloodline entry */
	'tree-structure': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M160,116h48a20,20,0,0,0,20-20V48a20,20,0,0,0-20-20H160a20,20,0,0,0-20,20V60H128a28,28,0,0,0-28,28v28H76v-4A20,20,0,0,0,56,92H24A20,20,0,0,0,4,112v32a20,20,0,0,0,20,20H56a20,20,0,0,0,20-20v-4h24v28a28,28,0,0,0,28,28h12v12a20,20,0,0,0,20,20h48a20,20,0,0,0,20-20V160a20,20,0,0,0-20-20H160a20,20,0,0,0-20,20v12H128a4,4,0,0,1-4-4V88a4,4,0,0,1,4-4h12V96A20,20,0,0,0,160,116ZM52,140H28V116H52Zm112,24h40v40H164Zm0-112h40V92H164Z"/></svg>`,
	'users-three': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M164.38,181.1a52,52,0,1,0-72.76,0,75.89,75.89,0,0,0-30,28.89,12,12,0,0,0,20.78,12,53,53,0,0,1,91.22,0,12,12,0,1,0,20.78-12A75.89,75.89,0,0,0,164.38,181.1ZM100,144a28,28,0,1,1,28,28A28,28,0,0,1,100,144Zm147.21,9.59a12,12,0,0,1-16.81-2.39c-8.33-11.09-19.85-19.59-29.33-21.64a12,12,0,0,1-1.82-22.91,20,20,0,1,0-24.78-28.3,12,12,0,1,1-21-11.6,44,44,0,1,1,73.28,48.35,92.18,92.18,0,0,1,22.85,21.69A12,12,0,0,1,247.21,153.59Zm-192.28-24c-9.48,2.05-21,10.55-29.33,21.65A12,12,0,0,1,6.41,136.79,92.37,92.37,0,0,1,29.26,115.1a44,44,0,1,1,73.28-48.35,12,12,0,1,1-21,11.6,20,20,0,1,0-24.78,28.3,12,12,0,0,1-1.82,22.91Z"/></svg>`,
	/** Shield (Phosphor Bold) — Story Tree: a faction's header card */
	'shield-bold': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M208,36H48A20,20,0,0,0,28,56v56c0,54.29,26.32,87.22,48.4,105.29,23.71,19.39,47.44,26,48.44,26.29a12.1,12.1,0,0,0,6.32,0c1-.28,24.73-6.9,48.44-26.29,22.08-18.07,48.4-51,48.4-105.29V56A20,20,0,0,0,208,36Zm-4,76c0,35.71-13.09,64.69-38.91,86.15A126.28,126.28,0,0,1,128,219.38a126.14,126.14,0,0,1-37.09-21.23C65.09,176.69,52,147.71,52,112V60H204Z"/></svg>`,

	/** Shield — a character's Strength */
	'shield': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M208,40H48A16,16,0,0,0,32,56v58.78c0,89.61,75.82,119.34,91,124.39a15.53,15.53,0,0,0,10,0c15.2-5.05,91-34.78,91-124.39V56A16,16,0,0,0,208,40Zm0,74.79c0,78.42-66.35,104.62-80,109.18-13.53-4.51-80-30.69-80-109.18V56H208Z"/></svg>`,

	/** Ghost — a character's Fear */
	'ghost': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A92.1,92.1,0,0,0,36,116v96a8,8,0,0,0,13.07,6.19l21.61-17.67,21.74,17.77a8,8,0,0,0,10.13,0L124.27,200.6l21.74,17.77a8,8,0,0,0,10.13,0l21.74-17.77,21.61,17.67A8,8,0,0,0,212.56,212H220V116A92.1,92.1,0,0,0,128,24Zm76,171.12-13.54-11.07a8,8,0,0,0-10.13,0l-21.74,17.77L136.85,184a8,8,0,0,0-10.13,0L105,201.82,83.24,184.05a8,8,0,0,0-10.13,0L52,195.12V116a76,76,0,0,1,152,0ZM108,108a12,12,0,1,1-12-12A12,12,0,0,1,108,108Zm64,0a12,12,0,1,1-12-12A12,12,0,0,1,172,108Z"/></svg>`,

	/** Concentric target — goals and significance */
	'target': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm0-152a64,64,0,1,0,64,64A64.07,64.07,0,0,0,128,64Zm0,112a48,48,0,1,1,48-48A48.05,48.05,0,0,1,128,176Zm0-80a32,32,0,1,0,32,32A32,32,0,0,0,128,96Zm0,48a16,16,0,1,1,16-16A16,16,0,0,1,128,144Z"/></svg>`,

	/** Two people — family, relationships */
	/** user-minus Bold — Dashboard "Who's gone quiet" */
	'user-minus': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M256,136a12,12,0,0,1-12,12H204a12,12,0,0,1,0-24h40A12,12,0,0,1,256,136Zm-54.81,56.28a12,12,0,1,1-18.38,15.44C169.12,191.42,145,172,108,172c-28.89,0-55.46,12.68-74.81,35.72a12,12,0,0,1-18.38-15.44A124.08,124.08,0,0,1,63.5,156.53a72,72,0,1,1,89,0A124,124,0,0,1,201.19,192.28ZM108,148a48,48,0,1,0-48-48A48.05,48.05,0,0,0,108,148Z"/></svg>`,
	'users': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M117.25,157.92a60,60,0,1,0-66.5,0A95.83,95.83,0,0,0,3.53,195.63a8,8,0,1,0,13.4,8.74,80,80,0,0,1,134.14,0,8,8,0,0,0,13.4-8.74A95.83,95.83,0,0,0,117.25,157.92ZM40,108a44,44,0,1,1,44,44A44.05,44.05,0,0,1,40,108Zm210.14,98.7a8,8,0,0,1-11.07-2.33A79.83,79.83,0,0,0,172,168a8,8,0,0,1,0-16,44,44,0,1,0-16.34-84.87,8,8,0,1,1-5.94-14.85,60,60,0,0,1,55.53,105.64,95.83,95.83,0,0,1,47.22,37.71A8,8,0,0,1,250.14,206.7Z"/></svg>`,

	/** Clock — memories, the past */
	'clock': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z"/></svg>`,

	/** Repeat — Dashboard "Crutch words across the book" (Bold) */
	'repeat': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M20,128A76.08,76.08,0,0,1,96,52h99l-3.52-3.51a12,12,0,1,1,17-17l24,24a12,12,0,0,1,0,17l-24,24a12,12,0,0,1-17-17L195,76H96a52.06,52.06,0,0,0-52,52,12,12,0,0,1-24,0Zm204-12a12,12,0,0,0-12,12,52.06,52.06,0,0,1-52,52H61l3.52-3.51a12,12,0,1,0-17-17l-24,24a12,12,0,0,0,0,17l24,24a12,12,0,1,0,17-17L61,204h99a76.08,76.08,0,0,0,76-76A12,12,0,0,0,224,116Z"/></svg>`,

	/** Wave — Dashboard "Pace across the book" (Bold) */
	'wave-sine': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M242.86,133.1c-23,49-43,70.9-64.82,70.9-27.64,0-43.8-34.44-60.9-70.9C110,117.78,102.53,102,94.92,90.73,88.39,81.09,82.53,76,78,76c-3.82,0-18.24,4.12-43.09,57.1a12,12,0,0,1-21.73-10.2c23-49,43-70.9,64.82-70.9,27.64,0,43.8,34.44,60.9,70.9,7.19,15.32,14.61,31.15,22.22,42.37,6.53,9.64,12.39,14.73,17,14.73,3.82,0,18.24-4.12,43.09-57.1a12,12,0,0,1,21.73,10.2Z"/></svg>`,

	/** Padlock — secrets */
	'lock': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96ZM208,208H48V96H208Zm-68-56a12,12,0,1,1-12-12A12,12,0,0,1,140,152Z"/></svg>`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Scene-type picker — the ordered list shown in the card editing dropdown.
// Extend this list (and PHOSPHOR_ICONS above) when the user chooses more icons.
// ─────────────────────────────────────────────────────────────────────────────

export interface SceneIconOption {
	value: string;   // key into PHOSPHOR_ICONS; stored in SceneCard.sceneIcon
	label: string;   // human-readable label shown in the dropdown
}

export const SCENE_ICON_OPTIONS: SceneIconOption[] = [
	{ value: 'book-open', label: 'Book — Backstory / Exposition' },
	{ value: 'flame',     label: 'Flame — Action / Conflict'     },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inject a Phosphor Bold icon SVG into `el`, replacing any existing content.
 * Falls back to `fallback` text if the icon name is not in the registry.
 * Adds the `sg-phosphor-icon` class so CSS can size all icons uniformly.
 *
 * @example
 *   setPhosphorIcon(btn, 'trash', '🗑');
 */
/**
 * Names that point at an icon stored under another key. Module definitions (modules.ts) use the
 * `sg-…` names Obsidian's addIcon() registers, and History uses Obsidian's 'history' name — without
 * this, setPhosphorIcon() fell back to ◆ for them (Welcome page + settings module cards).
 */
const ICON_ALIASES: Record<string, string> = {
	'sg-graph': 'graph-new',
	history: 'clock',
};

/** Look up an icon by its own name, an alias, or its `sg-` registered name. */
export function resolvePhosphorIcon(name: string): string | undefined {
	return PHOSPHOR_ICONS[name]
		?? PHOSPHOR_ICONS[ICON_ALIASES[name] ?? '']
		?? (name.startsWith('sg-') ? PHOSPHOR_ICONS[name.slice(3)] : undefined);
}

export function setPhosphorIcon(el: HTMLElement, name: string, fallback = '◆'): void {
	const svg = resolvePhosphorIcon(name);
	if (svg) {
		setStaticMarkup(el, svg);
		// Stamp explicit square HTML attributes so the browser never infers
		// the default 300×150 intrinsic size — without these the aspect ratio
		// calculation is wrong regardless of CSS width/height rules.
		const svgEl = el.querySelector('svg');
		if (svgEl) {
			svgEl.setAttribute('width', '16');
			svgEl.setAttribute('height', '16');
		}
		el.addClass('sg-phosphor-icon');
	} else {
		console.warn(`[Plotverk] Unknown Phosphor icon: "${name}". Add it to src/utils/icons.ts`);
		el.textContent = fallback;
	}
}

/**
 * The planet SVG as a bare string for Obsidian's `addIcon('sg-planet', PLANET_SVG)`
 * registration — lets the icon appear in Menu.addItem().setIcon() calls.
 */
export const PLANET_SVG = PHOSPHOR_ICONS['planet'];

/**
 * Plotverk brand mark — a 2×2 plot grid with one cell filled solid (the "scene
 * card placed on the grid", the product's signature gesture). Registered via
 * `addIcon('sg-storygrid', STORYGRID_MARK_SVG)` and used for the ribbon button so
 * Plotverk stands out from every other plugin's generic layout-grid icon.
 */
export const STORYGRID_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><rect x="136" y="32" width="88" height="88" rx="20"/><rect x="32" y="32" width="88" height="88" rx="20" fill="none" stroke="currentColor" stroke-width="18"/><rect x="32" y="136" width="88" height="88" rx="20" fill="none" stroke="currentColor" stroke-width="18"/><rect x="136" y="136" width="88" height="88" rx="20" fill="none" stroke="currentColor" stroke-width="18"/></svg>`;

/**
 * Note-with-pencil SVG for the Writers Panel tab icon — matches the glyph the
 * Dashboard already uses for the Writers Panel jump tile, keeping the brand
 * system coherent. Registered via `addIcon('sg-note-pencil', NOTE_PENCIL_SVG)`.
 */
export const NOTE_PENCIL_SVG = PHOSPHOR_ICONS['note-pencil'];

/** Connections Map view/menu icon (Phosphor graph U+EB58) — registered via `addIcon('sg-graph', …)`. */
export const GRAPH_SVG = PHOSPHOR_ICONS['graph-new'];

/** Plot Grid view/tab/menu icon — registered via `addIcon('sg-squares-four', …)`. */
export const SQUARES_FOUR_SVG = PHOSPHOR_ICONS['squares-four'];

/** Writers Panel view/tab/menu icon — registered via `addIcon('sg-pen-nib', …)`. */
export const PEN_NIB_SVG = PHOSPHOR_ICONS['pen-nib'];

/** Dashboard view/menu icon — registered via `addIcon('sg-chart-bar', …)`. */
export const CHART_BAR_SVG = PHOSPHOR_ICONS['chart-bar'];

export const GLOBE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,16a87.5,87.5,0,0,1,48,14.28V74L153.83,99.74,122.36,104l-.31-.22L102.38,90.92A16,16,0,0,0,79.87,95.1L58.93,126.4a16,16,0,0,0-2.7,8.81L56,171.44l-3.27,2.15A88,88,0,0,1,128,40ZM62.29,186.47l2.52-1.65A16,16,0,0,0,72,171.53l.21-36.23L93.17,104a3.62,3.62,0,0,0,.32.22l19.67,12.87a15.94,15.94,0,0,0,11.35,2.77L156,115.59a16,16,0,0,0,10-5.41l22.17-25.76A16,16,0,0,0,192,74V67.67A87.87,87.87,0,0,1,211.77,155l-16.14-14.76a16,16,0,0,0-16.93-3l-30.46,12.65a16.08,16.08,0,0,0-9.68,12.45l-2.39,16.19a16,16,0,0,0,11.77,17.81L169.4,202l2.36,2.37A87.88,87.88,0,0,1,62.29,186.47ZM185,195l-4.3-4.31a16,16,0,0,0-7.26-4.18L152,180.85l2.39-16.19L184.84,152,205,170.48A88.43,88.43,0,0,1,185,195Z"/></svg>`;

// ── Icon binding constants ────────────────────────────────────────────────────
// Single source of truth for each major view icon. Use these everywhere instead
// of hardcoded icon name strings, so a future icon change is a one-line edit.

/** Key used with setPhosphorIcon() for the Plot Grid view. Registered as 'sg-squares-four'. */
export const GRID_VIEW_ICON = 'squares-four' as const;

/** Key used with setPhosphorIcon() for the Writers Panel view. Registered as 'sg-pen-nib'. */
export const WRITERS_PANEL_ICON = 'pen-nib' as const;

/** Key used with setPhosphorIcon() for the Dashboard view. Registered as 'sg-chart-bar'. */
export const DASHBOARD_ICON = 'chart-bar' as const;

/** Key used with setPhosphorIcon() for the Codex view. Registered as 'sg-globe'. */
export const CODEX_ICON = 'globe' as const;

/** Key used with setPhosphorIcon() for the Connections Map. Registered as 'sg-graph'. */
export const CONNECTIONS_MAP_ICON = 'graph-new' as const;

/** Key used with setPhosphorIcon() for the Story Timeline (a dot on a line). Registered as 'sg-git-commit'. */
export const TIMELINE_ICON = 'git-commit' as const;

/** Timeline view/menu icon — registered via `addIcon('sg-git-commit', …)`. */
export const TIMELINE_SVG = PHOSPHOR_ICONS['git-commit'];
