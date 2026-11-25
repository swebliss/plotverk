/**
 * Plotverk promises it never talks to the internet: nothing about the writer's
 * story leaves their vault. This test fails the moment any code that can reach
 * the network appears in the plugin's source, or a new library is added that
 * nobody has checked. (Opening a web link the writer clicked, in their own
 * browser, is not Plotverk sending anything, so `window.open` is allowed.)
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname);

/** Every way a plugin could reach the network from Obsidian or Electron. */
const NETWORK_PATTERNS: Array<[string, RegExp]> = [
	['fetch()', /\bfetch\s*\(/],
	['XMLHttpRequest', /\bXMLHttpRequest\b/],
	["Obsidian's requestUrl", /\brequestUrl\b/],
	["Obsidian's request()", /\brequest\s*\(/],
	['WebSocket', /\bWebSocket\b/],
	['EventSource', /\bEventSource\b/],
	['sendBeacon', /\bsendBeacon\b/],
	['a Node network module', /(?:require\(\s*|from\s+)['"](?:node:)?(?:https?|http2|net|tls|dgram)['"]/],
	["Electron's net module", /\bnet\.request\b|\.net\b\s*\.\s*fetch/],
];

/** Libraries that ship inside Plotverk; each was checked for network calls. */
const CHECKED_LIBRARIES = ['@codemirror/state', '@codemirror/view', '@phosphor-icons/core', 'd3-force'];

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === '__mocks__') continue;
			out.push(...sourceFiles(full));
		} else if (/\.ts$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)) {
			out.push(full);
		}
	}
	return out;
}

/** Comments may talk about fetch() or the network; only real code counts. */
function withoutComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

describe('Plotverk never talks to the internet', () => {
	it('has no network calls anywhere in its source', () => {
		const found: string[] = [];
		// The public release swaps in these stand-ins, so they are checked too.
		const overrides = path.join(SRC, '..', 'release', 'overrides', 'src');
		const files = [...sourceFiles(SRC), ...(fs.existsSync(overrides) ? sourceFiles(overrides) : [])];
		for (const file of files) {
			const lines = withoutComments(fs.readFileSync(file, 'utf8')).split('\n');
			lines.forEach((line, i) => {
				for (const [what, re] of NETWORK_PATTERNS) {
					if (re.test(line)) found.push(`${path.relative(SRC, file)}:${i + 1} uses ${what}`);
				}
			});
		}
		expect(found).toEqual([]);
	});

	it('ships only libraries that were checked for network calls', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
		expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual([...CHECKED_LIBRARIES].sort());
	});

	it('would catch a network call if one were added', () => {
		const sample = 'const r = await requestUrl({ url });\nfetch("https://x");\nimport * as h from "https";';
		const hits = NETWORK_PATTERNS.filter(([, re]) => sample.split('\n').some((l) => re.test(l))).map(([w]) => w);
		expect(hits).toEqual(expect.arrayContaining(['fetch()', "Obsidian's requestUrl", 'a Node network module']));
	});
});
