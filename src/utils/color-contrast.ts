// Readable-foreground picking for user-chosen background colors.
//
// Moved VERBATIM out of grid-view.ts (where it was private) when the Timeline
// B4 event glyphs needed the same rule: a glyph knocked out of a dot the
// writer colored themselves has exactly the grid card's problem — a fixed
// white reads beautifully on a deep navy and vanishes on a pale yellow. The
// grid's behavior is unchanged; it now imports what it used to declare.

/**
 * Given a hex color string, return a dark or light CSS color value
 * based on relative luminance, so text is always readable on the card.
 */
export function getContrastColor(hexColor: string): string {
	const hex = hexColor.replace('#', '');
	if (hex.length !== 6) return 'var(--text-normal)';

	const r = parseInt(hex.substring(0, 2), 16) / 255;
	const g = parseInt(hex.substring(2, 4), 16) / 255;
	const b = parseInt(hex.substring(4, 6), 16) / 255;

	// Linearize sRGB channels
	const toLinear = (c: number) =>
		c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

	const luminance =
		0.2126 * toLinear(r) +
		0.7152 * toLinear(g) +
		0.0722 * toLinear(b);

	// Threshold of 0.4: keeps dark text on pastels, white text on dark/vivid colors
	return luminance > 0.4 ? '#1a1a1a' : '#ffffff';
}
