import { pickScopeRoot } from './scope-pick';

const scopes = [{ rootPath: 'Saltmarch' }, { rootPath: 'Series' }, { rootPath: 'Series/Spin-off' }];

describe('pickScopeRoot', () => {
	it('keeps a project that is in the list', () => {
		expect(pickScopeRoot(scopes, 'Saltmarch')).toBe('Saltmarch');
	});

	it('maps a book inside a series to the series around it', () => {
		expect(pickScopeRoot(scopes, 'Series/Book 1')).toBe('Series');
	});

	it('prefers the deepest folder that contains the book', () => {
		expect(pickScopeRoot(scopes, 'Series/Spin-off/Book 2')).toBe('Series/Spin-off');
	});

	it('does not match a folder that only starts with the same letters', () => {
		expect(pickScopeRoot(scopes, 'Saltmarch Extra', 'Series')).toBe('Series');
	});

	it('falls back to the active series, then the first project', () => {
		expect(pickScopeRoot(scopes, 'Gone', 'Series')).toBe('Series');
		expect(pickScopeRoot(scopes, 'Gone', 'Also gone')).toBe('Saltmarch');
		expect(pickScopeRoot(scopes, '')).toBe('Saltmarch');
	});

	it('keeps a project at the vault root when it is listed', () => {
		expect(pickScopeRoot([{ rootPath: 'A' }, { rootPath: '' }], '')).toBe('');
	});

	it('returns an empty root when there are no projects', () => {
		expect(pickScopeRoot([], 'Saltmarch')).toBe('');
	});
});
