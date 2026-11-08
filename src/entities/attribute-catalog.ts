import { EntityKind } from './entity-kinds';
import { CharacterField } from '../grid-data';
import { FieldConfig } from './field-types';

/**
 * Ready-made attributes, grouped into categories, offered by the field
 * builder's "New" route.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EVERY ENTRY HERE IS SUPPLIED BY THE USER. Do not add categories or
 * attributes that were not explicitly asked for — an earlier attempt filled
 * this file with an invented taxonomy and all of it had to be deleted.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Adding to it is the whole job: append a category (or a field to one) and it
 * appears in the builder, correctly typed, with no other change anywhere.
 */

export interface AttributeSpec {
	label: string;
	type: CharacterField['type'];
	/** Help text shown on the ⓘ beside the label once the field exists. */
	prompt: string;
	/** Type settings — slider bounds, dropdown choices, table columns. */
	config?: FieldConfig;
}

export interface AttributeCategory {
	title: string;
	fields: AttributeSpec[];
}

/** Keyed by entity kind. Kinds with no entry simply offer nothing extra. */
export const ATTRIBUTE_CATALOG: Partial<Record<EntityKind, AttributeCategory[]>> = {
	character: [
		{
			title: 'Personality',
			fields: [
				{
					label: 'Paranoid',
					type: 'slider',
					prompt: 'How suspicious is she of other people’s motives?',
					config: { min: 0, max: 100, step: 1 },
				},
			],
		},
		{
			title: 'Physical Appearance',
			fields: [
				{ label: 'Height', type: 'number', prompt: 'The character’s height.' },
				{ label: 'Weight', type: 'number', prompt: 'The character’s weight.' },
				{ label: 'Physical Build', type: 'tags', prompt: 'Their overall body build.' },
				{ label: 'Skin Tone', type: 'color', prompt: 'Their skin tone.' },
				{ label: 'Skin Type', type: 'tags', prompt: 'Their skin type.' },
				{ label: 'Skin Conditions', type: 'tags', prompt: 'Any conditions affecting their skin.' },
				{ label: 'Eye Color', type: 'color', prompt: 'Their eye color.' },
				{ label: 'Eye Color (Left)', type: 'color', prompt: 'Their left eye color, if it differs.' },
				{ label: 'Eye Color (Right)', type: 'color', prompt: 'Their right eye color, if it differs.' },
				{ label: 'Eye Shape', type: 'tags', prompt: 'The shape of their eyes.' },
				{ label: 'Natural Hair Color', type: 'color', prompt: 'Their natural hair color.' },
				{ label: 'Hair Color', type: 'color', prompt: 'Their current hair color.' },
				{ label: 'Secondary Hair Color', type: 'color', prompt: 'A secondary or highlight hair color.' },
				{ label: 'Hair Style', type: 'tags', prompt: 'How they wear their hair.' },
				{ label: 'Hair Length', type: 'number', prompt: 'The length of their hair.' },
				{ label: 'Facial Hair', type: 'tags', prompt: 'Their facial hair, if any.' },
				{ label: 'Facial Hair Color', type: 'color', prompt: 'The color of their facial hair.' },
				{ label: 'Body Hair Color', type: 'color', prompt: 'The color of their body hair.' },
				{ label: 'Hands', type: 'tags', prompt: 'Notable traits of their hands.' },
				{ label: 'Nail Color', type: 'color', prompt: 'Their nail color.' },
				{ label: 'Birthmarks', type: 'text', prompt: 'Any birthmarks and where they are.' },
				{ label: 'Scars', type: 'text', prompt: 'Any scars and where they are.' },
				{ label: 'Disfigurements', type: 'text', prompt: 'Any disfigurements.' },
				{ label: 'Tattoos', type: 'text', prompt: 'Any tattoos and where they are.' },
				{ label: 'Piercings', type: 'text', prompt: 'Any piercings and where they are.' },
				{ label: 'Geographical Adaptations', type: 'tags', prompt: 'Physical traits adapted to their environment or origin.' },
			],
		},
		{
			title: 'Health & Medical',
			fields: [
				{ label: 'Blood Type', type: 'tags', prompt: 'Their blood type.' },
				{ label: 'Health Status', type: 'tags', prompt: 'Their current health status.' },
				{ label: 'Allergies', type: 'tags', prompt: 'Anything they’re allergic to.' },
				{ label: 'Physical Illnesses', type: 'tags', prompt: 'Any physical illnesses.' },
				{ label: 'Neurodivergence', type: 'tags', prompt: 'Any neurodivergent traits.' },
				{ label: 'Psychological Disorders', type: 'tags', prompt: 'Any psychological disorders.' },
				{ label: 'Disabilities', type: 'tags', prompt: 'Any disabilities.' },
				{ label: 'Addictions', type: 'tags', prompt: 'Any addictions.' },
				{ label: 'Phobias', type: 'tags', prompt: 'Any phobias.' },
			],
		},
	],
	species: [
		{
			title: 'Physical Appearance',
			fields: [
				{ label: 'Physical Build', type: 'tags', prompt: 'Their typical body build.' },
				{ label: 'Skin Tone', type: 'color', prompt: 'Their typical skin tone.' },
				{ label: 'Skin Type', type: 'tags', prompt: 'Their typical skin type.' },
				{ label: 'Eye Color', type: 'color', prompt: 'Their typical eye color.' },
				{ label: 'Natural Hair Color', type: 'color', prompt: 'Their typical natural hair color.' },
				{ label: 'Hair Style', type: 'tags', prompt: 'How they typically wear their hair.' },
				{ label: 'Geographical Adaptations', type: 'tags', prompt: 'Physical traits adapted to their environment or origin.' },
			],
		},
	],
	monster: [
		{
			title: 'Physical Appearance',
			fields: [
				{ label: 'Physical Build', type: 'tags', prompt: 'Its overall body build.' },
				{ label: 'Skin Tone', type: 'color', prompt: 'Its skin, scale, or hide tone.' },
				{ label: 'Skin Type', type: 'tags', prompt: 'Its skin, scale, or hide type.' },
				{ label: 'Eye Color', type: 'color', prompt: 'Its eye color.' },
				{ label: 'Scars', type: 'text', prompt: 'Any scars and where they are.' },
				{ label: 'Disfigurements', type: 'text', prompt: 'Any disfigurements.' },
			],
		},
	],
};

/** The categories offered for a kind, or an empty list if it has none yet. */
export function attributeCategoriesFor(kind: EntityKind): AttributeCategory[] {
	return ATTRIBUTE_CATALOG[kind] ?? [];
}
