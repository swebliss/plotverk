import {
	galleryOrder,
	isDirectChild,
	isImagePath,
	isInsideFolder,
	planPortrait,
	safeImageFileName,
	safePathSegment,
	sheetImageFolder,
	uniqueChildPath,
} from './sheet-images-path';

describe('sheetImageFolder', () => {
	it('builds <project>/<Images>/<Kind>/<Sheet>', () => {
		expect(sheetImageFolder('Saltmarch', 'Images', 'Characters', 'Mara Ferrow')).toBe('Saltmarch/Images/Characters/Mara Ferrow');
	});

	it('handles nested projects and a project at the vault root', () => {
		expect(sheetImageFolder('Sweden/Gothenburg', 'Images', 'Places', 'Harbour')).toBe('Sweden/Gothenburg/Images/Places/Harbour');
		expect(sheetImageFolder('', 'Images', 'Characters', 'Mara')).toBe('Images/Characters/Mara');
	});

	it('keeps two sheets with the same name in different kinds apart', () => {
		expect(sheetImageFolder('S', 'Images', 'Characters', 'Crane'))
			.not.toBe(sheetImageFolder('S', 'Images', 'Factions', 'Crane'));
	});

	it('folds sub-folders into one folder name, so same-named sheets stay apart and never nest', () => {
		expect(sheetImageFolder('S', 'Images', 'Scenes', 'Opening', ['Chapter 1'])).toBe('S/Images/Scenes/Chapter 1 › Opening');
		expect(sheetImageFolder('S', 'Images', 'Scenes', 'Opening', ['Chapter 2'])).toBe('S/Images/Scenes/Chapter 2 › Opening');
		expect(sheetImageFolder('S', 'Images', 'Scenes', 'Opening', ['..'])).toBe('S/Images/Scenes/Untitled › Opening');
		// Sweden.md and Sweden/Gothenburg.md: siblings, not parent and child.
		const sweden = sheetImageFolder('S', 'Images', 'Places', 'Sweden');
		const gothenburg = sheetImageFolder('S', 'Images', 'Places', 'Gothenburg', ['Sweden']);
		expect(gothenburg.startsWith(`${sweden}/`)).toBe(false);
		expect(isDirectChild(`${gothenburg}/a.png`, sweden)).toBe(false);
	});

	it('falls back to "Images" when the folder-name setting is blank or unsafe', () => {
		expect(sheetImageFolder('S', '', 'Characters', 'Mara')).toBe('S/Images/Characters/Mara');
		expect(sheetImageFolder('S', '  ..  ', 'Characters', 'Mara')).toBe('S/Images/Characters/Mara');
	});

	it('never lets a sheet name climb out of its folder', () => {
		const p = sheetImageFolder('S', 'Images', 'Characters', '../../etc/passwd');
		expect(p.startsWith('S/Images/Characters/')).toBe(true);
		expect(p.split('/')).toHaveLength(4);
		expect(p.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')).toBe(false);
		expect(sheetImageFolder('S', 'Images/../x', 'Characters', 'Mara').split('/')).toHaveLength(4);
	});
});

describe('safePathSegment', () => {
	it('replaces characters Obsidian rejects', () => {
		expect(safePathSegment('Who? Me: [the] #1 | "boss"*', 'x')).toBe('Who- Me- -the- -1 - -boss--');
		expect(safePathSegment('a\\b/c^d<e>f', 'x')).toBe('a-b-c-d-e-f');
	});

	it('strips leading dots and trailing dots/spaces', () => {
		expect(safePathSegment('.hidden', 'x')).toBe('hidden');
		expect(safePathSegment('Name. . ', 'x')).toBe('Name');
		expect(safePathSegment('..', 'x')).toBe('x');
	});

	it('uses the fallback for empty or all-dash names', () => {
		expect(safePathSegment('   ', 'Untitled')).toBe('Untitled');
		expect(safePathSegment('///', 'Untitled')).toBe('Untitled');
	});

	it('steers clear of names Windows will not create', () => {
		expect(safePathSegment('Con', 'x')).toBe('Con_');
		expect(safePathSegment('lpt1', 'x')).toBe('lpt1_');
		expect(safePathSegment('Connor', 'x')).toBe('Connor');
	});

	it('keeps case and non-English letters', () => {
		expect(safePathSegment('Åsa Ödegård', 'x')).toBe('Åsa Ödegård');
	});
});

describe('safeImageFileName', () => {
	it('keeps a real file name, lower-casing the extension', () => {
		expect(safeImageFileName('Harbour at dusk.JPG', 'image/jpeg', 'Mara')).toBe('Harbour at dusk.jpg');
	});

	it('names a pasted "image.png" after the sheet', () => {
		expect(safeImageFileName('image.png', 'image/png', 'Mara Ferrow')).toBe('Mara Ferrow.png');
		expect(safeImageFileName('', 'image/jpeg', 'Mara Ferrow')).toBe('Mara Ferrow.jpg');
	});

	it('takes the extension from the type when the name has none', () => {
		expect(safeImageFileName('portrait', 'image/webp', 'Mara')).toBe('portrait.webp');
		expect(safeImageFileName('portrait', 'image/svg+xml', 'Mara')).toBe('portrait.svg');
		expect(safeImageFileName('portrait', 'application/octet-stream', 'Mara')).toBe('portrait.png');
	});

	it('drops any folder part and unsafe characters from the name', () => {
		expect(safeImageFileName('../../x:y.png', 'image/png', 'Mara')).toBe('x-y.png');
		expect(safeImageFileName('C:\\Users\\me\\a#b.png', 'image/png', 'Mara')).toBe('a-b.png');
	});
});

describe('uniqueChildPath', () => {
	it('returns name.png, then name 2.png, name 3.png', () => {
		const taken = new Set<string>();
		const exists = (p: string) => taken.has(p.toLowerCase());
		const a = uniqueChildPath('S/Images/Characters/Mara', 'Mara.png', exists);
		expect(a).toBe('S/Images/Characters/Mara/Mara.png');
		taken.add(a.toLowerCase());
		const b = uniqueChildPath('S/Images/Characters/Mara', 'Mara.png', exists);
		expect(b).toBe('S/Images/Characters/Mara/Mara 2.png');
		taken.add(b.toLowerCase());
		expect(uniqueChildPath('S/Images/Characters/Mara', 'MARA.PNG', exists)).toBe('S/Images/Characters/Mara/MARA 3.PNG');
	});

	it('works at the vault root', () => {
		expect(uniqueChildPath('', 'a.png', () => false)).toBe('a.png');
	});
});

describe('isImagePath / isInsideFolder', () => {
	it('recognises picture files', () => {
		expect(isImagePath('a/b/c.JPEG')).toBe(true);
		expect(isImagePath('a/b/c.md')).toBe(false);
		expect(isImagePath('a/b/png')).toBe(false);
	});

	it('matches whole folder names only, ignoring case', () => {
		expect(isInsideFolder('S/Images/Characters/Mara/a.png', 'S/Images/Characters/Mara')).toBe(true);
		expect(isInsideFolder('S/Images/Characters/mara/a.png', 'S/Images/Characters/Mara')).toBe(true);
		expect(isInsideFolder('S/Images/Characters/Mara 2/a.png', 'S/Images/Characters/Mara')).toBe(false);
	});
});

describe('galleryOrder', () => {
	it('puts the sheet’s own pictures first (portrait first), then the folder by name, each once', () => {
		expect(galleryOrder(['p/portrait.png', 'x.png'], ['p/c.png', 'p/portrait.png', 'p/b.png']))
			.toEqual(['p/portrait.png', 'x.png', 'p/b.png', 'p/c.png']);
	});
});

describe('planPortrait', () => {
	it('swaps a picture already on the sheet into first place', () => {
		expect(planPortrait(['a', 'b', 'c'], 'c', true)).toEqual(['c', 'b', 'a']);
		expect(planPortrait(['a', 'b'], 'a', true)).toEqual(['a', 'b']);
	});

	it('replaces the portrait when the old one still lives in the sheet’s folder', () => {
		expect(planPortrait(['a', 'b'], 'new', true)).toEqual(['new', 'b']);
	});

	it('keeps an old portrait from elsewhere on the sheet, so it never disappears', () => {
		expect(planPortrait(['vault-root.jpg', 'b'], 'new', false)).toEqual(['new', 'vault-root.jpg', 'b']);
	});

	it('adds the first portrait to a sheet with none', () => {
		expect(planPortrait([], 'new', false)).toEqual(['new']);
	});
});
