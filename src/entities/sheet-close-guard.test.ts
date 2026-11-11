import { hasUnsavedSheetWork, sheetFormState, SheetFormSnapshotInput } from './sheet-close-guard';

const base = (): SheetFormSnapshotInput => ({
	name: 'Tobin',
	aliases: [],
	fields: [{ label: 'Role', type: 'text', value: '', category: 'Basics' }],
	pendingRelations: [],
});

describe('sheet close guard', () => {
	const atOpen = sheetFormState(base());

	it('lets an untouched sheet close quietly', () => {
		expect(hasUnsavedSheetWork({ touched: false, uploadedCount: 0, stateNow: atOpen, stateAtOpen: atOpen })).toBe(false);
	});

	it('asks when a field value changed', () => {
		const now = base();
		now.fields[0].value = 'Smuggler';
		expect(hasUnsavedSheetWork({ touched: false, uploadedCount: 0, stateNow: sheetFormState(now), stateAtOpen: atOpen })).toBe(true);
	});

	it('asks when the name, an alias, a field or a pending relationship changed', () => {
		const renamed = { ...base(), name: 'Tobin Vale' };
		const aliased = { ...base(), aliases: ['The Fox'] };
		const added = { ...base(), fields: [...base().fields, { label: 'Fear', type: 'textarea', value: '' }] };
		const pending = { ...base(), pendingRelations: [{ name: 'Mara', word: 'Sister', picked: true }] };
		for (const s of [renamed, aliased, added, pending]) {
			expect(sheetFormState(s)).not.toBe(atOpen);
		}
	});

	it('asks when the writer typed, even if the values ended up the same', () => {
		expect(hasUnsavedSheetWork({ touched: true, uploadedCount: 0, stateNow: atOpen, stateAtOpen: atOpen })).toBe(true);
	});

	it('asks when a picture was imported, even before the form showed', () => {
		expect(hasUnsavedSheetWork({ touched: false, uploadedCount: 1, stateNow: atOpen, stateAtOpen: null })).toBe(true);
	});

	it('never asks on the start steps, before the form was shown', () => {
		expect(hasUnsavedSheetWork({ touched: true, uploadedCount: 0, stateNow: atOpen, stateAtOpen: null })).toBe(false);
	});
});
