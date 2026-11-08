/**
 * Minimal dependency-free ZIP writer using only "stored" (uncompressed)
 * entries. Every ZIP reader accepts stored entries, which keeps this free of a
 * compression library. Shared by the EPUB and DOCX exporters (both are ZIPs of
 * XML parts). Pure module — no Obsidian imports.
 */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
	name: string;
	data: Uint8Array;
}

/** Build an uncompressed ZIP from entries, preserving their order. */
export function buildZip(entries: ZipEntry[]): Uint8Array {
	const encoder = new TextEncoder();
	const localParts: Uint8Array[] = [];
	const centralParts: Uint8Array[] = [];
	let offset = 0;

	for (const entry of entries) {
		const nameBytes = encoder.encode(entry.name);
		const crc = crc32(entry.data);
		const size = entry.data.length;

		const local = new Uint8Array(30 + nameBytes.length + size);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true); // local file header
		lv.setUint16(4, 20, true); // version needed
		lv.setUint16(6, 0x0800, true); // UTF-8 names
		lv.setUint16(8, 0, true); // method: stored
		lv.setUint32(10, 0, true); // mod time/date
		lv.setUint32(14, crc, true);
		lv.setUint32(18, size, true); // compressed size
		lv.setUint32(22, size, true); // uncompressed size
		lv.setUint16(26, nameBytes.length, true);
		lv.setUint16(28, 0, true); // extra length
		local.set(nameBytes, 30);
		local.set(entry.data, 30 + nameBytes.length);
		localParts.push(local);

		const central = new Uint8Array(46 + nameBytes.length);
		const cv = new DataView(central.buffer);
		cv.setUint32(0, 0x02014b50, true); // central directory header
		cv.setUint16(4, 20, true); // version made by
		cv.setUint16(6, 20, true); // version needed
		cv.setUint16(8, 0x0800, true);
		cv.setUint16(10, 0, true);
		cv.setUint32(12, 0, true);
		cv.setUint32(16, crc, true);
		cv.setUint32(20, size, true);
		cv.setUint32(24, size, true);
		cv.setUint16(28, nameBytes.length, true);
		cv.setUint32(42, offset, true); // local header offset
		central.set(nameBytes, 46);
		centralParts.push(central);

		offset += local.length;
	}

	const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
	const eocd = new Uint8Array(22);
	const ev = new DataView(eocd.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, entries.length, true);
	ev.setUint16(10, entries.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);

	const total = offset + centralSize + 22;
	const out = new Uint8Array(total);
	let pos = 0;
	for (const p of [...localParts, ...centralParts, eocd]) {
		out.set(p, pos);
		pos += p.length;
	}
	return out;
}
