import type { WebLink } from '../grid-data';

export type { WebLink };

/**
 * Turn what the writer typed or pasted into a safe web address, or null.
 * "example.com/page" gets https:// in front; only http and https are
 * accepted, so a pasted "javascript:" or "file:" address can never be opened.
 * A user name or password inside the address is dropped, so it is never
 * saved in the grid file or shown on the card.
 */
export function normalizeWebUrl(input: unknown): string | null {
	if (typeof input !== 'string') return null;
	const raw = input.trim();
	if (!raw || /\s/.test(raw)) return null;
	const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
	// "localhost:3000" or "example.com:8080?q=1" look like a scheme but are a host with a port.
	const hostWithPort = /^[a-z0-9.-]+:\d+([/?#]|$)/i.test(raw);
	const candidate = hasScheme && !hostWithPort ? raw : `https://${raw}`;
	let parsed: URL;
	try {
		parsed = new URL(candidate);
	} catch {
		return null;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
	// A bare word ("hello") is not a web address: the host needs a dot, be localhost, or be an IPv6 address.
	const host = parsed.hostname;
	if (!host.includes('.') && host !== 'localhost' && !host.startsWith('[')) return null;
	parsed.username = '';
	parsed.password = '';
	return parsed.href;
}

/**
 * The web links on a card, cleaned: a hand-edited grid file may hold junk
 * where the list belongs (not a list, empty items, a number for a name).
 * Only items with a text address are kept, and only a text name.
 */
export function cleanWebLinks(raw: unknown): WebLink[] {
	if (!Array.isArray(raw)) return [];
	const out: WebLink[] = [];
	for (const item of raw as unknown[]) {
		if (!item || typeof item !== 'object') continue;
		const { url, label } = item as { url?: unknown; label?: unknown };
		if (typeof url !== 'string' || !url) continue;
		out.push(typeof label === 'string' && label.trim() ? { url, label } : { url });
	}
	return out;
}

/** What a link chip shows: the writer's name for it, else the site's name without "www.". */
export function webLinkLabel(link: WebLink): string {
	const label = link.label?.trim();
	if (label) return label;
	try {
		const host = new URL(link.url).hostname.replace(/^www\./, '');
		return host.split('.').map(decodeIdnLabel).join('.');
	} catch {
		return link.url;
	}
}

/** Add a link at the end; the same address again keeps its place and takes the newer name. */
export function addWebLink(links: readonly WebLink[] | undefined, link: WebLink): WebLink[] {
	const list = links ?? [];
	const clean: WebLink = link.label?.trim() ? { url: link.url, label: link.label.trim() } : { url: link.url };
	if (list.some((l) => l.url === clean.url)) return list.map((l) => (l.url === clean.url ? clean : l));
	return [...list, clean];
}

/** Remove the link with this address. */
export function removeWebLink(links: readonly WebLink[] | undefined, url: string): WebLink[] {
	return (links ?? []).filter((l) => l.url !== url);
}

/**
 * Browsers store a name like "bücher.de" as "xn--bcher-kva.de"; this turns
 * one such part back into the letters the writer would recognise (the
 * Punycode decoder from RFC 3492). Anything it can't decode is shown as is.
 */
function decodeIdnLabel(part: string): string {
	if (!part.toLowerCase().startsWith('xn--')) return part;
	try {
		return punycodeDecode(part.slice(4));
	} catch {
		return part;
	}
}

function punycodeDecode(input: string): string {
	const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
	const adapt = (delta: number, numPoints: number, first: boolean): number => {
		let k = 0;
		delta = first ? Math.floor(delta / damp) : delta >> 1;
		delta += Math.floor(delta / numPoints);
		for (; delta > ((base - tMin) * tMax) >> 1; k += base) delta = Math.floor(delta / (base - tMin));
		return Math.floor(k + ((base - tMin + 1) * delta) / (delta + skew));
	};
	const digitOf = (cp: number): number =>
		cp >= 48 && cp <= 57 ? cp - 22 : cp >= 65 && cp <= 90 ? cp - 65 : cp >= 97 && cp <= 122 ? cp - 97 : base;

	const output: number[] = [];
	const basic = Math.max(0, input.lastIndexOf('-'));
	for (let j = 0; j < basic; j++) output.push(input.charCodeAt(j));
	let i = 0, n = 128, bias = 72;
	for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length;) {
		const oldi = i;
		let w = 1;
		for (let k = base; ; k += base) {
			if (idx >= input.length) throw new Error('bad punycode');
			const digit = digitOf(input.charCodeAt(idx++));
			if (digit >= base) throw new Error('bad punycode');
			i += digit * w;
			const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
			if (digit < t) break;
			w *= base - t;
		}
		const out = output.length + 1;
		bias = adapt(i - oldi, out, oldi === 0);
		n += Math.floor(i / out);
		i %= out;
		output.splice(i++, 0, n);
	}
	return String.fromCodePoint(...output);
}
