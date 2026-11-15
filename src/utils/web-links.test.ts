import { addWebLink, cleanWebLinks, normalizeWebUrl, removeWebLink, webLinkLabel } from './web-links';

describe('normalizeWebUrl', () => {
	it('keeps a full https address', () => {
		expect(normalizeWebUrl('https://example.com/page?a=1')).toBe('https://example.com/page?a=1');
	});
	it('adds https:// to a bare address', () => {
		expect(normalizeWebUrl('  example.com/maps ')).toBe('https://example.com/maps');
		expect(normalizeWebUrl('www.wikipedia.org')).toBe('https://www.wikipedia.org/');
	});
	it('treats host:port as an address, not a scheme', () => {
		expect(normalizeWebUrl('localhost:3000')).toBe('https://localhost:3000/');
		expect(normalizeWebUrl('example.com:8080/x')).toBe('https://example.com:8080/x');
	});
	it('accepts http', () => {
		expect(normalizeWebUrl('http://example.com')).toBe('http://example.com/');
	});
	it('refuses anything that is not a web page', () => {
		expect(normalizeWebUrl('javascript:alert(1)')).toBeNull();
		expect(normalizeWebUrl('file:///C:/secret.txt')).toBeNull();
		expect(normalizeWebUrl('obsidian://open?vault=x')).toBeNull();
		expect(normalizeWebUrl('mailto:a@b.com')).toBeNull();
	});
	it('refuses empty text, spaces and bare words', () => {
		expect(normalizeWebUrl('')).toBeNull();
		expect(normalizeWebUrl('   ')).toBeNull();
		expect(normalizeWebUrl('my research notes')).toBeNull();
		expect(normalizeWebUrl('hello')).toBeNull();
	});
});

describe('normalizeWebUrl — edge cases', () => {
	it('accepts a host and port followed by a query or anchor', () => {
		expect(normalizeWebUrl('example.com:8080?q=1')).toBe('https://example.com:8080/?q=1');
		expect(normalizeWebUrl('example.com:8080#x')).toBe('https://example.com:8080/#x');
	});
	it('accepts IPv6 addresses', () => {
		expect(normalizeWebUrl('http://[::1]/')).toBe('http://[::1]/');
		expect(normalizeWebUrl('[2001:db8::1]:8080')).toBe('https://[2001:db8::1]:8080/');
	});
	it('drops a user name and password inside the address', () => {
		expect(normalizeWebUrl('https://user:secret@site.com/page')).toBe('https://site.com/page');
	});
	it('refuses anything that is not text', () => {
		expect(normalizeWebUrl(7)).toBeNull();
		expect(normalizeWebUrl(undefined)).toBeNull();
	});
});

describe('cleanWebLinks', () => {
	it('keeps good links as they are', () => {
		expect(cleanWebLinks([{ url: 'https://a.com/', label: 'A' }, { url: 'https://b.com/' }]))
			.toEqual([{ url: 'https://a.com/', label: 'A' }, { url: 'https://b.com/' }]);
	});
	it('turns junk into an empty list', () => {
		expect(cleanWebLinks(undefined)).toEqual([]);
		expect(cleanWebLinks({})).toEqual([]);
		expect(cleanWebLinks('https://a.com')).toEqual([]);
	});
	it('drops broken items and a name that is not text', () => {
		expect(cleanWebLinks([null, 3, { url: 5 }, { label: 'x' }, { url: 'https://a.com/', label: 7 }]))
			.toEqual([{ url: 'https://a.com/' }]);
	});
});

describe('webLinkLabel', () => {
	it('shows a name with non-English letters as the writer would type it', () => {
		expect(webLinkLabel({ url: 'https://xn--bcher-kva.de/' })).toBe('bücher.de');
		expect(webLinkLabel({ url: normalizeWebUrl('https://www.bücher.de/x') ?? '' })).toBe('bücher.de');
		expect(webLinkLabel({ url: 'https://xn--fiqs8s.cn/' })).toBe('中国.cn');
	});
	it("uses the writer's name", () => {
		expect(webLinkLabel({ url: 'https://example.com', label: ' Lighthouses ' })).toBe('Lighthouses');
	});
	it("falls back to the site's name without www.", () => {
		expect(webLinkLabel({ url: 'https://www.wikipedia.org/wiki/Lighthouse' })).toBe('wikipedia.org');
		expect(webLinkLabel({ url: 'https://example.com', label: '  ' })).toBe('example.com');
	});
});

describe('addWebLink / removeWebLink', () => {
	it('adds to an empty card', () => {
		expect(addWebLink(undefined, { url: 'https://a.com/' })).toEqual([{ url: 'https://a.com/' }]);
	});
	it('keeps one copy of the same address, in its place, with the newer name', () => {
		const list = [{ url: 'https://a.com/', label: 'Old' }, { url: 'https://b.com/' }];
		expect(addWebLink(list, { url: 'https://a.com/', label: ' New ' })).toEqual([
			{ url: 'https://a.com/', label: 'New' },
			{ url: 'https://b.com/' },
		]);
	});
	it('adds a new address at the end', () => {
		expect(addWebLink([{ url: 'https://a.com/' }], { url: 'https://b.com/' })).toEqual([
			{ url: 'https://a.com/' },
			{ url: 'https://b.com/' },
		]);
	});
	it('does not change the list it was given', () => {
		const list = [{ url: 'https://a.com/' }];
		addWebLink(list, { url: 'https://b.com/' });
		removeWebLink(list, 'https://a.com/');
		expect(list).toEqual([{ url: 'https://a.com/' }]);
	});
	it('removes by address', () => {
		expect(removeWebLink([{ url: 'https://a.com/' }, { url: 'https://b.com/' }], 'https://a.com/')).toEqual([{ url: 'https://b.com/' }]);
		expect(removeWebLink(undefined, 'https://a.com/')).toEqual([]);
	});
});
