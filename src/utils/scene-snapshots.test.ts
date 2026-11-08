import {
	snapshotFolderFor,
	snapshotFileName,
	parseSnapshotFileName,
	formatSnapshotTimestamp,
} from './scene-snapshots-paths';

describe('snapshotFolderFor', () => {
	it('nests a hidden folder named after the file, inside the scene\'s own directory', () => {
		expect(snapshotFolderFor('My Story/Scenes/Act 1/Opening.md')).toBe(
			'My Story/Scenes/Act 1/.storygrid-snapshots/Opening.md'
		);
	});

	it('handles a scene one folder deep', () => {
		expect(snapshotFolderFor('Scenes/Opening.md')).toBe('Scenes/.storygrid-snapshots/Opening.md');
	});

	it('handles a bare filename with no folder at all', () => {
		expect(snapshotFolderFor('Opening.md')).toBe('.storygrid-snapshots/Opening.md');
	});
});

describe('snapshotFileName / parseSnapshotFileName round-trip', () => {
	it('recovers the same timestamp and reason after building then parsing', () => {
		const now = new Date('2026-07-02T14:05:30.123Z');
		const name = snapshotFileName('compile', now);
		expect(name).toBe('2026-07-02T14-05-30-123Z.compile.txt');

		const basename = name.replace(/\.txt$/, '');
		const parsed = parseSnapshotFileName(basename);
		expect(parsed).toEqual({ timestamp: '2026-07-02T14-05-30-123Z', reason: 'compile' });
	});

	it('round-trips every reason value', () => {
		const now = new Date('2026-01-01T00:00:00.000Z');
		for (const reason of ['daily', 'compile', 'manual', 'pre-restore'] as const) {
			const basename = snapshotFileName(reason, now).replace(/\.txt$/, '');
			expect(parseSnapshotFileName(basename)?.reason).toBe(reason);
		}
	});

	it('returns null for a basename that is not a snapshot (e.g. an unrelated file)', () => {
		expect(parseSnapshotFileName('random-note')).toBeNull();
		expect(parseSnapshotFileName('2026-07-02T14-05-30-123Z.unknown-reason')).toBeNull();
	});

	it('produces timestamps that sort correctly as plain strings, newest first', () => {
		const earlier = snapshotFileName('daily', new Date('2026-07-01T09:00:00.000Z')).replace(/\.txt$/, '');
		const later = snapshotFileName('daily', new Date('2026-07-02T09:00:00.000Z')).replace(/\.txt$/, '');
		const stamps = [parseSnapshotFileName(earlier)!.timestamp, parseSnapshotFileName(later)!.timestamp];
		expect([...stamps].sort((a, b) => b.localeCompare(a))).toEqual([
			parseSnapshotFileName(later)!.timestamp,
			parseSnapshotFileName(earlier)!.timestamp,
		]);
	});
});

describe('formatSnapshotTimestamp', () => {
	it('formats a valid stamp as a locale date/time string', () => {
		const formatted = formatSnapshotTimestamp('2026-07-02T14-05-30-123Z');
		// Exact wording is locale-dependent; just confirm it parsed (not a raw-stamp fallback) and contains the year.
		expect(formatted).not.toBe('2026-07-02T14-05-30-123Z');
		expect(formatted).toContain('2026');
	});

	it('falls back to the raw string for a malformed stamp', () => {
		expect(formatSnapshotTimestamp('not-a-timestamp')).toBe('not-a-timestamp');
	});
});
