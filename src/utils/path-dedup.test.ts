import { numberedPathVariant, dedupePath } from './path-dedup';

describe('numberedPathVariant', () => {
	test('inserts the number before the extension', () => {
		expect(numberedPathVariant('img.png', 2)).toBe('img 2.png');
		expect(numberedPathVariant('Assets/portrait.jpeg', 3)).toBe('Assets/portrait 3.jpeg');
	});

	test('appends the number for extensionless names', () => {
		expect(numberedPathVariant('portrait', 2)).toBe('portrait 2');
	});

	test('a dotted folder does not count as an extension', () => {
		expect(numberedPathVariant('dir.v2/portrait', 2)).toBe('dir.v2/portrait 2');
	});
});

describe('dedupePath', () => {
	test('returns the path unchanged when free', () => {
		expect(dedupePath('img.png', () => false)).toBe('img.png');
	});

	test('extensionless collision terminates and numbers correctly (the old regex looped forever)', () => {
		const taken = new Set(['portrait', 'portrait 2']);
		expect(dedupePath('portrait', (p) => taken.has(p))).toBe('portrait 3');
	});

	test('numbers derive from the original path, never compounding', () => {
		const taken = new Set(['img.png', 'img 2.png', 'img 3.png']);
		expect(dedupePath('img.png', (p) => taken.has(p))).toBe('img 4.png');
	});

	test('cap exhaustion still returns a unique-looking path instead of hanging', () => {
		const result = dedupePath('img.png', () => true, 50);
		expect(result).toMatch(/^img \d+\.png$/);
	});
});
