import { FIELD_TYPES, FieldType, defaultConfig, slugForLabel, slugsForLabels, encodeYamlValue, decodeValue, formatFieldValue, isFieldEmpty, parseStoryDateJson, isEchoOfEarlierField } from './field-types';

describe('field-types registry', () => {
	test('slugForLabel produces a clean lowercase-hyphen key', () => {
		expect(slugForLabel('Full Name')).toBe('full-name');
		expect(slugForLabel('One-Line Essence')).toBe('one-line-essence');
	});

	test('slugForLabel prefixes field- on collision with a reserved frontmatter key', () => {
		expect(slugForLabel('Tags')).toBe('field-tags');
		expect(slugForLabel('Aliases')).toBe('field-aliases');
		expect(slugForLabel('cssClasses')).toBe('field-cssclasses');
		expect(slugForLabel('Position')).toBe('field-position');
	});

	// An empty or all-dashes YAML key breaks the whole frontmatter block, and a
	// sheet whose frontmatter will not parse disappears from the Codex.
	test('slugForLabel never returns an unusable key', () => {
		const unusable = ['名前', 'Персонаж', '🔥', '---', '-', '?!', '   '];
		for (const label of unusable) {
			const key = slugForLabel(label);
			expect(key).toMatch(/^field-[a-z0-9]+$/);
		}
	});

	test('slugForLabel is deterministic — the same label always gives the same key', () => {
		expect(slugForLabel('名前')).toBe(slugForLabel('名前'));
		expect(slugForLabel('🔥')).toBe(slugForLabel('🔥'));
		// Hard-coded so a change to the hash function shows up as a failing test
		// rather than as silently orphaned values in everyone's vault.
		expect(slugForLabel('名前')).toBe('field-1cadmz3');
	});

	test('slugForLabel keeps distinct non-Latin labels distinct', () => {
		expect(slugForLabel('名前')).not.toBe(slugForLabel('年齢'));
		expect(slugForLabel('Персонаж')).not.toBe(slugForLabel('Место'));
	});

	test('slugForLabel leaves ordinary labels exactly as they were', () => {
		expect(slugForLabel('Full Name')).toBe('full-name');
		expect(slugForLabel('Age')).toBe('age');
		expect(slugForLabel('Tags')).toBe('field-tags');
	});

	test('slugsForLabels de-duplicates labels that slug the same', () => {
		expect(slugsForLabels(['Age?', 'Age!'])).toEqual(['age', 'age-2']);
		expect(slugsForLabels(['Age', 'Age', 'Age'])).toEqual(['age', 'age-2', 'age-3']);
	});

	test('slugsForLabels leaves a set with no collisions untouched', () => {
		expect(slugsForLabels(['Full Name', 'Age', 'Tags'])).toEqual(['full-name', 'age', 'field-tags']);
	});

	test('slugsForLabels resolves a suffix that collides with a real label', () => {
		expect(slugsForLabels(['Age', 'Age!', 'Age 2'])).toEqual(['age', 'age-2', 'age-2-2']);
	});

	test('defaultConfig gives every widget-configurable type sane starting values', () => {
		expect(defaultConfig('slider')).toEqual({ min: 0, max: 100, step: 1 });
		expect(defaultConfig('select')).toEqual({ options: [] });
		expect(defaultConfig('matrix')).toEqual({ xAxis: ['', ''], yAxis: ['', ''] });
		expect(defaultConfig('text')).toEqual({});
	});

	describe('encode/decode round-trip for every field type', () => {
		const cases: Array<{ type: FieldType; value: string; config?: ReturnType<typeof defaultConfig> }> = [
			{ type: 'text', value: 'Hello world' },
			{ type: 'tags', value: 'a, b, c' },
			{ type: 'number', value: '27' },
			{ type: 'slider', value: '62', config: { min: 0, max: 100, step: 1 } },
			{ type: 'select', value: 'Alive' },
			{ type: 'checkbox', value: 'true' },
			{ type: 'checkbox', value: 'false' },
			{ type: 'date', value: '2026-07-30' },
			{ type: 'matrix', value: '62,-30' },
			{ type: 'color', value: '#7C69C8' },
			{ type: 'storydate', value: JSON.stringify({ era: 'Fourth Age', year: 12, month: 3, day: 14 }) },
		];

		for (const c of cases) {
			test(`${c.type} = "${c.value}"`, () => {
				const encoded = encodeYamlValue(c.type, c.value, c.config);
				expect(encoded).not.toBeNull();
				const decoded = decodeValue(c.type, encoded as string);
				expect(decoded).toBe(c.value);
			});
		}

		test('image and textarea never encode to frontmatter', () => {
			expect(encodeYamlValue('image', 'Portraits/mara.png')).toBeNull();
			expect(encodeYamlValue('textarea', 'Some prose.')).toBeNull();
		});

		test('empty values encode to null (field omitted from frontmatter)', () => {
			for (const type of FIELD_TYPES) {
				expect(encodeYamlValue(type, '')).toBeNull();
			}
		});
	});

	describe('YAML shape', () => {
		test('tags emit a flow array of quoted strings', () => {
			expect(encodeYamlValue('tags', 'brave, loyal')).toBe('["brave", "loyal"]');
		});

		test('number and slider emit bare numbers', () => {
			expect(encodeYamlValue('number', '27')).toBe('27');
			expect(encodeYamlValue('slider', '62')).toBe('62');
		});

		test('checkbox emits a bare boolean', () => {
			expect(encodeYamlValue('checkbox', 'true')).toBe('true');
			expect(encodeYamlValue('checkbox', 'false')).toBe('false');
		});

		test('date emits unquoted', () => {
			expect(encodeYamlValue('date', '2026-07-30')).toBe('2026-07-30');
		});

		test('matrix emits a flow map', () => {
			expect(encodeYamlValue('matrix', '62,-30')).toBe('{x: 62, y: -30}');
		});

		test('text with special characters is quoted and escaped', () => {
			expect(encodeYamlValue('text', 'She said "hi"')).toBe('"She said \\"hi\\""');
		});

		test('color emits a quoted hex string', () => {
			expect(encodeYamlValue('color', '#7C69C8')).toBe('"#7C69C8"');
		});
	});

	describe('formatFieldValue', () => {
		test('empty value formats to empty string for every type', () => {
			for (const type of FIELD_TYPES) {
				expect(formatFieldValue(type, '')).toBe('');
			}
		});

		test('slider shows value / max', () => {
			expect(formatFieldValue('slider', '62', { max: 100 })).toBe('62 / 100');
		});

		test('checkbox shows a check or cross', () => {
			expect(formatFieldValue('checkbox', 'true')).toBe('✓');
			expect(formatFieldValue('checkbox', 'false')).toBe('✗');
		});

		test('tags render as inline code chips', () => {
			expect(formatFieldValue('tags', 'brave, loyal')).toBe('`brave` `loyal`');
		});

		test('matrix uses the pole label matching each value\'s sign', () => {
			const config = { xAxis: ['Cold', 'Warm'] as [string, string], yAxis: ['Calm', 'Bold'] as [string, string] };
			expect(formatFieldValue('matrix', '62,-30', config)).toBe('Warm 62 · Calm -30');
		});

		test('storydate renders a plain numeric string, no calendar needed', () => {
			expect(formatFieldValue('storydate', JSON.stringify({ year: 940 }))).toBe('Year 940');
			expect(formatFieldValue('storydate', JSON.stringify({ era: 'Fourth Age', year: 12, month: 3, day: 14 })))
				.toBe('Fourth Age, Year 12, Month 3, Day 14');
		});

		test('storydate with malformed JSON formats to empty string', () => {
			expect(formatFieldValue('storydate', '{not json')).toBe('');
		});
	});

	describe('isFieldEmpty', () => {
		test('blank value is empty for every simple type', () => {
			for (const type of ['text', 'textarea', 'tags', 'image', 'number', 'select', 'date', 'color'] as FieldType[]) {
				expect(isFieldEmpty(type, '')).toBe(true);
				expect(isFieldEmpty(type, '   ')).toBe(true);
			}
		});

		test('non-blank value is not empty for every simple type', () => {
			for (const type of ['text', 'textarea', 'tags', 'image', 'number', 'select', 'date', 'color'] as FieldType[]) {
				expect(isFieldEmpty(type, 'x')).toBe(false);
			}
		});

		test('slider at its min value is treated as empty', () => {
			expect(isFieldEmpty('slider', '0')).toBe(true); // default min is 0
			expect(isFieldEmpty('slider', '', { min: 0, max: 100, step: 1 })).toBe(true);
			expect(isFieldEmpty('slider', '10', { min: 10, max: 100, step: 1 })).toBe(true);
			expect(isFieldEmpty('slider', '0', { min: 10, max: 100, step: 1 })).toBe(false); // below min ≠ untouched
			expect(isFieldEmpty('slider', '62', { min: 0, max: 100, step: 1 })).toBe(false);
		});

		test('checkbox is empty unless explicitly true', () => {
			expect(isFieldEmpty('checkbox', '')).toBe(true);
			expect(isFieldEmpty('checkbox', 'false')).toBe(true);
			expect(isFieldEmpty('checkbox', 'true')).toBe(false);
		});

		test('matrix at dead-centre (0,0) is empty, whitespace-tolerant', () => {
			expect(isFieldEmpty('matrix', '')).toBe(true);
			expect(isFieldEmpty('matrix', '0,0')).toBe(true);
			expect(isFieldEmpty('matrix', ' 0 , 0 ')).toBe(true);
			expect(isFieldEmpty('matrix', '0,1')).toBe(false);
			expect(isFieldEmpty('matrix', '62,-30')).toBe(false);
		});

		test('list is empty when it has no real items', () => {
			expect(isFieldEmpty('list', '')).toBe(true);
			expect(isFieldEmpty('list', '\n \n')).toBe(true);
			expect(isFieldEmpty('list', 'Item one')).toBe(false);
		});

		test('table is empty when it has no real rows', () => {
			expect(isFieldEmpty('table', '')).toBe(true);
			expect(isFieldEmpty('table', '[]')).toBe(true);
			expect(isFieldEmpty('table', JSON.stringify([['', '']]))).toBe(false); // parseTableRows keeps blank-cell rows; only '' collapses
			expect(isFieldEmpty('table', JSON.stringify([['Name', 'Notes']]))).toBe(false);
		});

		test('storydate is empty when blank or unparseable, not empty once it has a year', () => {
			expect(isFieldEmpty('storydate', '')).toBe(true);
			expect(isFieldEmpty('storydate', '{not json')).toBe(true);
			expect(isFieldEmpty('storydate', JSON.stringify({ month: 3 }))).toBe(true); // no year
			expect(isFieldEmpty('storydate', JSON.stringify({ year: 940 }))).toBe(false);
		});
	});
});

describe('parseStoryDateJson()', () => {
	test('parses a full structured date', () => {
		expect(parseStoryDateJson(JSON.stringify({ era: 'Fourth Age', year: 12, month: 3, day: 14, minute: 90 })))
			.toEqual({ era: 'Fourth Age', year: 12, month: 3, day: 14, minute: 90 });
	});

	test('a bare year is valid on its own', () => {
		expect(parseStoryDateJson(JSON.stringify({ year: 940 }))).toEqual({ year: 940 });
	});

	test('returns null for blank input', () => {
		expect(parseStoryDateJson('')).toBeNull();
		expect(parseStoryDateJson('   ')).toBeNull();
	});

	test('returns null when year is missing or not a number', () => {
		expect(parseStoryDateJson(JSON.stringify({ month: 3, day: 14 }))).toBeNull();
		expect(parseStoryDateJson(JSON.stringify({ year: '940' }))).toBeNull();
	});

	test('returns null for malformed JSON', () => {
		expect(parseStoryDateJson('{not json')).toBeNull();
	});
});

describe('isEchoOfEarlierField (Codex page shows a repeated field once)', () => {
	const a = { label: 'Voice & Mannerisms', value: 'Clipped, precise.' };
	test('same label once punctuation is ignored, same text: an echo', () => {
		expect(isEchoOfEarlierField({ label: 'Voice Mannerisms', value: ' Clipped, precise. ' }, [a])).toBe(true);
	});
	test('different text, or a different label, is its own field', () => {
		expect(isEchoOfEarlierField({ label: 'Voice Mannerisms', value: 'Loud.' }, [a])).toBe(false);
		expect(isEchoOfEarlierField({ label: 'Voice', value: 'Clipped, precise.' }, [a])).toBe(false);
		expect(isEchoOfEarlierField(a, [a])).toBe(false);
	});
});
