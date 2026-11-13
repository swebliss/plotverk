import { CharacterField, generateId } from '../grid-data';
import { FieldConfig, defaultValueForType } from './field-types';
import { attributeCategoriesFor } from './attribute-catalog';
import { NEW_WORLDBUILDING_KINDS, CODEX_GROUPS, CodexGroupSpec } from './worldbuilding-kinds';

export type { CodexGroupSpec } from './worldbuilding-kinds';
export { CODEX_GROUPS } from './worldbuilding-kinds';

/**
 * Central registry of every worldbuilding entity kind Plotverk knows about.
 * All per-kind copy, folder names, icons, and guided default fields live here
 * so the modal, the codex view, and the grid view stay in sync.
 */

export type BuiltinEntityKind = 'character' | 'location' | 'scene' | 'faction' | 'system' | 'item' | 'research' | 'event';
/**
 * A worldbuilding entity kind. The seven built-ins are string-literal typed so
 * existing code keeps autocomplete and exhaustiveness; user-defined custom kinds
 * are arbitrary string ids. `(string & {})` widens to any string WITHOUT
 * collapsing the literal union (so 'character' etc. still autocomplete).
 */
export type EntityKind = BuiltinEntityKind | (string & {});

export interface EntityFieldSpec {
	label: string;
	type: CharacterField['type'];
	/** Guided placeholder shown in the empty input — a craft question, not just "Value..." */
	prompt: string;
	/** Type settings carried through creation — slider bounds, dropdown choices. */
	config?: FieldConfig;
}

/** A named group of fields shown as one collapsible section in the editor. */
export interface EntitySectionSpec {
	title: string;
	/** Phosphor icon name (utils/icons.ts registry) */
	icon: string;
	/** Field labels belonging to this section, in display order */
	fields: string[];
}

export interface EntityKindSpec {
	kind: EntityKind;
	singular: string;
	plural: string;
	/** Lucide icon name */
	icon: string;
	/** Text fallback if the icon fails to load */
	fallbackIcon: string;
	/** Sub-folder name inside the project folder */
	folderName: string;
	/** Obsidian callout type for the at-a-glance table */
	calloutType: string;
	calloutTitle: string;
	/** Short line shown in empty states / section descriptions */
	tagline: string;
	defaultName: string;
	defaultFields: EntityFieldSpec[];
	/** Editor sections — unlisted fields fall into a catch-all "More" group */
	sections?: EntitySectionSpec[];
	/** Optional alternative starting field sets (e.g. Magic System vs. Government) */
	presets?: Array<{ name: string; fields: EntityFieldSpec[] }>;
	/**
	 * The kind's craft heart — short text fields promoted to an accent chip
	 * grid at the top of the detail page (e.g. a character's Want/Need/Flaw)
	 * instead of being buried in the sidebar fact table.
	 */
	heroFields?: Array<{ label: string; icon: string }>;
	/** Heading over the hero chip grid */
	heroTitle?: string;
	/**
	 * Curated one-click field additions offered in the sheet editor for
	 * writers who want to dig deeper (Quirks, Family, Important Memories…).
	 */
	suggestedFields?: EntityFieldSpec[];
	/**
	 * The fields a clean slate of this kind starts with, when the kind needs
	 * more than one big text box (an Event needs its dates to sit on the Timeline).
	 * Unset: one Notes text box only — see cleanSlateFieldSpecs().
	 */
	cleanSlateFields?: EntityFieldSpec[];
	/**
	 * Other field sets this kind's sheets can start from, offered by a caller
	 * rather than the template picker (an Event's guided Era). Editing such a
	 * sheet merges against the set it fits best, like a preset, so an era
	 * never grows the event template's fields back.
	 */
	extraFieldSets?: EntityFieldSpec[][];
	/** Accent color (hex) for this kind — used by the relationship map + detail page. Built-ins may leave this unset and fall back to CSS. */
	color?: string;
	/** How the Codex gallery renders this kind: rich 'card' (default) or dense 'row' for high-count kinds like a lexicon. */
	displayShape?: 'card' | 'row';
	/** True for the seven shipped kinds, false for user-defined custom kinds. Set automatically by the registry — do not set by hand. */
	builtin?: boolean;
}

const f = (label: string, type: CharacterField['type'], prompt: string): EntityFieldSpec => ({ label, type, prompt });

/**
 * An Event's "How Long" choice: a moment draws a round badge on
 * the Timeline; something that lasts a while draws a bar — to its End Date,
 * or up to the story's present when it has none; an era draws a soft colour
 * band behind everything across its years (same End Date rule). Left empty it
 * follows the sheet: an End Date means "Lasts a while", none means "A moment"
 * (see eventDurationFrom in timeline-events.ts), so older sheets need no change.
 */
export const EVENT_HOW_LONG = { moment: 'A moment', lasting: 'Lasts a while', era: 'An era' } as const;
const HOW_LONG_FIELD: EntityFieldSpec = {
	label: 'How Long',
	type: 'select',
	prompt: 'A moment, something that lasts a while, or a whole era? Something that lasts shows as a bar on the Timeline, an era as a soft band behind its years — to its End Date, or up to the story’s present if it is still going on.',
	config: { options: [EVENT_HOW_LONG.moment, EVENT_HOW_LONG.lasting, EVENT_HOW_LONG.era] },
};

const ERA_DATE_FIELD = f('Date', 'storydate', 'When does this era begin?');
const ERA_END_FIELD = f('End Date', 'storydate', 'When does it end? Leave empty if it is still going on — the band then runs up to the story’s present.');
/** The band's colour on the Timeline (frontmatter `color`) — the sheet is the one place it lives. */
const ERA_COLOR_FIELD = f('Color', 'color', 'The colour of this era’s band on the Timeline. Leave empty for a gentle one picked for you.');
const ERA_DESCRIPTION_FIELD = f('Description', 'textarea', 'This age in a sentence or two — it shows when you hover its band.');

/**
 * "Add era" on the Timeline. An era is an Event sheet whose How
 * Long is "An era" — one kind, one folder, so rename, delete and links work
 * like any event, and a sheet can switch between event and era. These are
 * the two starts the pop-up offers for it: a clean slate and a short guided era.
 */
export const ERA_SHEET = {
	singular: 'Era',
	icon: 'hourglass',
	fallbackIcon: '⌛',
	tagline: 'An age of your world — a soft band behind its years on the Timeline.',
	cleanSlateFields: [ERA_DATE_FIELD, HOW_LONG_FIELD, ERA_END_FIELD, ERA_COLOR_FIELD, ERA_DESCRIPTION_FIELD] as EntityFieldSpec[],
	guidedFields: [
		ERA_DATE_FIELD,
		HOW_LONG_FIELD,
		ERA_END_FIELD,
		ERA_COLOR_FIELD,
		ERA_DESCRIPTION_FIELD,
		f('What Defines This Age', 'textarea', 'What defines this age? Who holds power, what people fear, what everyone takes for granted…'),
		f('How It Began', 'textarea', 'What started it — a war, a flood, a crowning, a discovery?'),
		f('How It Ends', 'textarea', 'How does it end — or what would end it?'),
	] as EntityFieldSpec[],
};

const CHARACTER_SPEC: EntityKindSpec = {
	kind: 'character',
	singular: 'Character',
	plural: 'Characters',
	icon: 'user',
	fallbackIcon: '👤',
	folderName: 'Characters',
	calloutType: 'info',
	calloutTitle: 'Character at a Glance',
	tagline: 'The people who carry your story — their wants, wounds, and contradictions.',
	defaultName: 'Unnamed Character',
	defaultFields: [
		f('Full Name', 'text', 'The character’s full name'),
		f('Role', 'text', 'Protagonist, antagonist, mentor, foil…'),
		f('Age', 'text', 'Age, or life stage if exact age doesn’t matter'),
		{
			label: 'Gender',
			type: 'select',
			prompt: 'Leave empty if it doesn’t matter. Family ties on other sheets use it: niece or nephew, grandson or granddaughter.',
			config: { options: ['Female', 'Male', 'Non-binary'] },
		},
		f('One-Line Essence', 'text', 'Who are they in a single sentence?'),
		f('Want', 'text', 'What do they consciously pursue? (external goal)'),
		f('Need', 'text', 'What do they actually need to be whole? (internal)'),
		f('Flaw', 'text', 'The weakness or lie they believe that holds them back'),
		f('Strength', 'text', 'What makes them formidable or lovable?'),
		f('Fear', 'text', 'What are they most afraid of losing or facing?'),
		f('Portrait', 'image', 'Vault path to a portrait image'),
		f('Appearance', 'textarea', 'What does someone notice first? Build from there…'),
		f('Voice & Mannerisms', 'textarea', 'How do they speak and move? Verbal tics, habits, tells…'),
		f('Character Arc', 'textarea', 'Where do they start, what breaks them open, who are they at the end?'),
		f('Backstory', 'textarea', 'The wound, the history — what made them this person?'),
		f('Relationships', 'textarea', 'Key bonds and frictions. Link people with [[wikilinks]]…'),
		f('Notes', 'textarea', 'Anything else — secrets, trivia, casting ideas…'),
	],
	sections: [
		{ title: 'Identity', icon: 'user', fields: ['Full Name', 'Role', 'Age', 'Gender', 'One-Line Essence'] },
		{ title: 'Inner Life', icon: 'sparkles', fields: ['Want', 'Need', 'Flaw', 'Strength', 'Fear'] },
		{ title: 'Presence', icon: 'note-pencil', fields: ['Appearance', 'Voice & Mannerisms'] },
		{ title: 'Story', icon: 'book-open', fields: ['Character Arc', 'Backstory', 'Relationships'] },
		{ title: 'Notes', icon: 'books', fields: ['Notes'] },
	],
	heroTitle: 'Drives',
	heroFields: [
		{ label: 'Want', icon: 'heart' },
		{ label: 'Need', icon: 'compass' },
		{ label: 'Flaw', icon: 'warning' },
		{ label: 'Strength', icon: 'shield' },
		{ label: 'Fear', icon: 'ghost' },
	],
	suggestedFields: [
		f('Quirks', 'tags', 'Small habits and oddities — bites nails, hums when lying…'),
		f('Family', 'textarea', 'Parents, siblings, found family. Link people with [[wikilinks]]…'),
		f('Important Memories', 'textarea', 'The moments that made them — triumphs, wounds, firsts…'),
		f('Secrets', 'textarea', 'What do they hide, and from whom? What happens if it comes out?'),
		f('Beliefs & Values', 'textarea', 'What do they hold true about the world — and where are they wrong?'),
		f('Possessions', 'textarea', 'What do they carry, treasure, or refuse to give up?'),
		f('Habits & Routines', 'textarea', 'A normal day — work, rituals, vices…'),
		f('Occupation', 'text', 'What do they do for a living?'),
		f('Birthplace', 'text', 'Where are they from?'),
		f('Life Status', 'text', 'Alive, deceased, missing, unknown…'),
		f('Born', 'storydate', 'When were they born? Powers ages on the Timeline.'),
		f('Died', 'storydate', 'When did they die, if known? Leave blank if alive.'),
	],
};

const LOCATION_SPEC: EntityKindSpec = {
	kind: 'location',
	singular: 'Place',
	plural: 'Places',
	icon: 'map-pin',
	fallbackIcon: '📍',
	folderName: 'Places',
	calloutType: 'tip',
	calloutTitle: 'Place at a Glance',
	tagline: 'The places your story lives in — make readers smell the air.',
	defaultName: 'Unnamed Place',
	defaultFields: [
		f('Name', 'text', 'What is this place called?'),
		f('Type', 'text', 'City, tavern, forest, space station…'),
		f('In One Sentence', 'text', 'The essence of this place in one line'),
		f('Atmosphere', 'text', 'The mood it casts — oppressive, cozy, sacred, decaying…'),
		f('Significance', 'text', 'Why does the story need this place?'),
		f('Cover Image', 'image', 'Vault path to an image of this place'),
		f('Sensory Details', 'textarea', 'Sights, sounds, smells, textures — what do visitors feel?'),
		f('Who Is Found Here', 'textarea', 'Inhabitants, regulars, creatures. Link with [[wikilinks]]…'),
		f('Secrets & Dangers', 'textarea', 'What is hidden here? What can hurt you?'),
		f('History', 'textarea', 'What happened here before the story began?'),
		f('Notes', 'textarea', 'Maps, floor plans, anything else…'),
	],
	sections: [
		{ title: 'Essentials', icon: 'map-pin', fields: ['Name', 'Type', 'In One Sentence', 'Atmosphere', 'Significance'] },
		{ title: 'Sense of Place', icon: 'sparkles', fields: ['Sensory Details', 'Who Is Found Here'] },
		{ title: 'Beneath the Surface', icon: 'flame', fields: ['Secrets & Dangers', 'History'] },
		{ title: 'Notes', icon: 'books', fields: ['Notes'] },
	],
	heroTitle: 'Essence',
	heroFields: [
		{ label: 'Atmosphere', icon: 'sparkles' },
		{ label: 'Significance', icon: 'target' },
	],
	suggestedFields: [
		f('Sounds & Smells', 'textarea', 'What does this place sound and smell like at different hours?'),
		f('Weather & Seasons', 'textarea', 'How does the place change across the year?'),
		f('Local Customs', 'textarea', 'Greetings, taboos, festivals — what marks an outsider here?'),
		f('Key Landmarks', 'textarea', 'The spots scenes will return to. Link with [[wikilinks]]…'),
		f('Population', 'text', 'Roughly how many live here?'),
		f('Ruled By', 'text', 'Who is in charge of this place? Link with [[wikilinks]]'),
	],
};

const SCENE_SPEC: EntityKindSpec = {
	kind: 'scene',
	singular: 'Scene',
	plural: 'Scenes',
	icon: 'film-script',
	fallbackIcon: '🎬',
	folderName: 'Scenes',
	calloutType: 'abstract',
	calloutTitle: 'Scene at a Glance',
	tagline: 'The beats of your story, one moment at a time.',
	defaultName: 'Untitled Scene',
	defaultFields: [
		f('Title', 'text', 'A working title for this scene'),
		f('POV Character', 'text', 'Whose eyes are we behind?'),
		f('Location', 'text', 'Where does this scene take place?'),
		f('Scene Goal', 'text', 'What does the POV character want in this scene?'),
		f('Conflict', 'text', 'What stands in the way?'),
		f('Outcome', 'text', 'Yes / no / yes-but / no-and — how does it end?'),
		f('Value Shift', 'text', 'What changes? (e.g. hope → despair, trust → betrayal)'),
		f('Summary', 'textarea', 'What happens, beat by beat?'),
		f('Notes', 'textarea', 'Lines of dialogue, imagery, reminders…'),
	],
	sections: [
		{ title: 'Essentials', icon: 'film-script', fields: ['Title', 'POV Character', 'Location'] },
		{ title: 'Drive', icon: 'flame', fields: ['Scene Goal', 'Conflict', 'Outcome', 'Value Shift'] },
		{ title: 'On the Page', icon: 'book-open', fields: ['Summary', 'Notes'] },
	],
	heroTitle: 'Drive',
	heroFields: [
		{ label: 'Scene Goal', icon: 'target' },
		{ label: 'Conflict', icon: 'flame' },
		{ label: 'Outcome', icon: 'compass' },
		{ label: 'Value Shift', icon: 'sparkles' },
	],
	suggestedFields: [
		f('Sensory Anchor', 'text', 'One concrete detail that grounds the scene'),
		f('Time & Weather', 'text', 'When does this happen — and what is the sky doing?'),
		f('Foreshadowing', 'textarea', 'What seeds are planted here for later?'),
		f('Callbacks', 'textarea', 'What earlier setups does this scene pay off?'),
	],
};

const FACTION_SPEC: EntityKindSpec = {
	kind: 'faction',
	singular: 'Faction',
	plural: 'Factions & Organizations',
	icon: 'flag',
	fallbackIcon: '🚩',
	folderName: 'Factions',
	calloutType: 'example',
	calloutTitle: 'Faction at a Glance',
	tagline: 'Kingdoms, guilds, cults, corporations — the groups that move your world.',
	defaultName: 'Unnamed Faction',
	defaultFields: [
		f('Name', 'text', 'What is this group called?'),
		f('Type', 'text', 'Kingdom, guild, cult, rebellion, corporation…'),
		f('Motto or Creed', 'text', 'The line they live (or kill) by'),
		f('Goal', 'text', 'What does this faction want above all?'),
		f('Methods', 'text', 'How far will they go to get it?'),
		f('Leader', 'text', 'Who holds the power? Link with [[wikilinks]]'),
		f('Headquarters', 'text', 'Where are they based? Link with [[wikilinks]]'),
		f('Emblem', 'image', 'Vault path to a crest, flag, or logo image'),
		f('Structure & Ranks', 'textarea', 'How is it organised? Who answers to whom?'),
		f('Resources & Power', 'textarea', 'Armies, wealth, magic, influence, information…'),
		f('Allies & Enemies', 'textarea', 'Who do they work with, and who wants them gone?'),
		f('History', 'textarea', 'How did this faction come to be?'),
		f('Notes', 'textarea', 'Internal conflicts, secrets, future plans…'),
	],
	sections: [
		{ title: 'Identity', icon: 'flag', fields: ['Name', 'Type', 'Motto or Creed'] },
		{ title: 'Ambition', icon: 'flame', fields: ['Goal', 'Methods'] },
		{ title: 'People & Places', icon: 'user', fields: ['Leader', 'Headquarters'] },
		{ title: 'Power', icon: 'sparkles', fields: ['Structure & Ranks', 'Resources & Power', 'Allies & Enemies'] },
		{ title: 'History & Notes', icon: 'books', fields: ['History', 'Notes'] },
	],
	heroTitle: 'Ambition',
	heroFields: [
		{ label: 'Goal', icon: 'target' },
		{ label: 'Methods', icon: 'flame' },
		{ label: 'Motto or Creed', icon: 'flag' },
	],
	suggestedFields: [
		f('Symbols & Colors', 'text', 'How do you recognise them at a glance?'),
		f('Membership', 'textarea', 'Who joins, how, and what does leaving cost?'),
		f('Secrets', 'textarea', 'What does the faction hide — even from its own members?'),
		f('Reputation', 'textarea', 'What do outsiders believe about them, true or not?'),
	],
};

const SYSTEM_SPEC: EntityKindSpec = {
	kind: 'system',
	singular: 'System',
	plural: 'Systems',
	icon: 'sparkles',
	fallbackIcon: '✨',
	folderName: 'Systems',
	calloutType: 'note',
	calloutTitle: 'System at a Glance',
	tagline: 'Magic, governments, economies, religions — the rules your world runs on.',
	defaultName: 'Unnamed System',
	defaultFields: [
		f('Name', 'text', 'What is this system called?'),
		f('Type', 'text', 'Magic, government, religion, economy, technology…'),
		f('In One Sentence', 'text', 'The essence of this system in one line'),
		f('Rules', 'textarea', 'How does it work? What are the laws it always obeys?'),
		f('Limitations', 'textarea', 'What can it NOT do? Limits create tension…'),
		f('Costs', 'textarea', 'What does using it cost — energy, sanity, years of life, money?'),
		f('Access & Control', 'textarea', 'Who can use it? Who controls or regulates it?'),
		f('Impact on Society', 'textarea', 'How does daily life bend around this system?'),
		f('Loopholes & Edge Cases', 'textarea', 'Where can it be exploited? Your plot may live here…'),
		f('Origin', 'textarea', 'Where did it come from? Who discovered or built it?'),
		f('Notes', 'textarea', 'Open questions, inconsistencies to resolve…'),
	],
	sections: [
		{ title: 'Essentials', icon: 'sparkles', fields: ['Name', 'Type', 'In One Sentence', 'Source of Power', 'Currency', 'Core Belief'] },
		{ title: 'How It Works', icon: 'books', fields: ['Rules', 'Limitations', 'Costs', 'How It Is Learned', 'Practices & Rituals', 'How Power Transfers', 'Laws & Justice', 'Key Resources', 'Trade & Routes'] },
		{ title: 'In the World', icon: 'map-pin', fields: ['Access & Control', 'Impact on Society', 'Who Holds Power', 'Deities & Figures', 'Institutions', 'Class & Inequality', 'Factions Within', 'Schisms & Heresies'] },
		{ title: 'Plot Fuel', icon: 'flame', fields: ['Loopholes & Edge Cases', 'Origin', 'Weaknesses', 'Black Markets', 'Truth Behind It'] },
		{ title: 'Notes', icon: 'note-pencil', fields: ['Notes'] },
	],
	presets: [
		{
			name: 'Magic System',
			fields: [
				f('Name', 'text', 'What is this magic called?'),
				f('Type', 'text', 'Hard magic, soft magic, ritual, innate…'),
				f('Source of Power', 'text', 'Where does the magic come from?'),
				f('Rules', 'textarea', 'How is it cast or invoked? What laws does it obey?'),
				f('Limitations', 'textarea', 'What can it never do? Who cannot use it?'),
				f('Costs', 'textarea', 'What does each use cost the wielder?'),
				f('How It Is Learned', 'textarea', 'Born with it, studied, granted, stolen?'),
				f('Impact on Society', 'textarea', 'How has magic shaped power, war, medicine, class?'),
				f('Effect on Characters & World', 'textarea', 'A magic system should change something: how do characters think or act because of it, or how does it change the way the world operates?'),
				f('Loopholes & Edge Cases', 'textarea', 'Exploits and grey areas — plot fuel…'),
				f('Notes', 'textarea', 'Open questions to resolve…'),
			],
		},
		{
			name: 'Government',
			fields: [
				f('Name', 'text', 'What is this government called?'),
				f('Type', 'text', 'Monarchy, republic, theocracy, council of mages…'),
				f('In One Sentence', 'text', 'The essence of how this place is ruled'),
				f('Who Holds Power', 'textarea', 'Rulers, bodies, dynasties. Link with [[wikilinks]]…'),
				f('How Power Transfers', 'textarea', 'Succession, elections, coups, divine right?'),
				f('Laws & Justice', 'textarea', 'What is forbidden? How are wrongdoers punished?'),
				f('Factions Within', 'textarea', 'Court rivalries, parties, ministries at war with each other…'),
				f('Weaknesses', 'textarea', 'Corruption, unrest, debt — where could it crack?'),
				f('Notes', 'textarea', 'Open questions to resolve…'),
			],
		},
		{
			name: 'Religion or Belief',
			fields: [
				f('Name', 'text', 'What is this faith called?'),
				f('Type', 'text', 'Organised religion, folk belief, cult, philosophy…'),
				f('Core Belief', 'text', 'The one truth its followers hold'),
				f('Deities & Figures', 'textarea', 'Gods, prophets, saints. Link with [[wikilinks]]…'),
				f('Practices & Rituals', 'textarea', 'Worship, holidays, rites of passage, taboos…'),
				f('Institutions', 'textarea', 'Temples, clergy, hierarchies — who speaks for the faith?'),
				f('Schisms & Heresies', 'textarea', 'Where do believers disagree? Conflict lives here…'),
				f('Truth Behind It', 'textarea', 'Is any of it real? What does the author know that followers don’t?'),
				f('Notes', 'textarea', 'Open questions to resolve…'),
			],
		},
		{
			name: 'Economy & Trade',
			fields: [
				f('Name', 'text', 'What is this economic system called?'),
				f('Currency', 'text', 'What do people trade with?'),
				f('In One Sentence', 'text', 'How wealth works here, in one line'),
				f('Key Resources', 'textarea', 'What is scarce, what is abundant, who controls it?'),
				f('Trade & Routes', 'textarea', 'What moves where, and who profits?'),
				f('Class & Inequality', 'textarea', 'Who is rich, who is poor, and can that change?'),
				f('Black Markets', 'textarea', 'What is traded in the shadows?'),
				f('Notes', 'textarea', 'Open questions to resolve…'),
			],
		},
	],
};

const ITEM_SPEC: EntityKindSpec = {
	kind: 'item',
	singular: 'Item',
	plural: 'Items & Inventory',
	icon: 'gem',
	fallbackIcon: '💎',
	folderName: 'Items',
	calloutType: 'quote',
	calloutTitle: 'Item at a Glance',
	tagline: 'Artifacts, weapons, heirlooms — the objects your plot turns on.',
	defaultName: 'Unnamed Item',
	defaultFields: [
		f('Name', 'text', 'What is this item called?'),
		f('Type', 'text', 'Weapon, artifact, heirloom, document, vehicle…'),
		f('Current Owner', 'text', 'Who has it now? Link with [[wikilinks]]'),
		f('Significance', 'text', 'Why does the story care about this object?'),
		f('Image', 'image', 'Vault path to an image of this item'),
		f('Appearance', 'textarea', 'What does it look, feel, sound like?'),
		f('Powers & Function', 'textarea', 'What does it do — mundane or magical?'),
		f('Limitations & Price', 'textarea', 'What can it not do? What does using it cost?'),
		f('Origin & History', 'textarea', 'Who made it, who has held it, what has it seen?'),
		f('Notes', 'textarea', 'Where it is now, where it must end up…'),
	],
	sections: [
		{ title: 'Essentials', icon: 'gem', fields: ['Name', 'Type', 'Current Owner', 'Significance'] },
		{ title: 'Description', icon: 'note-pencil', fields: ['Appearance', 'Powers & Function'] },
		{ title: 'The Price', icon: 'flame', fields: ['Limitations & Price'] },
		{ title: 'History & Notes', icon: 'books', fields: ['Origin & History', 'Notes'] },
	],
	heroTitle: 'Why It Matters',
	heroFields: [
		{ label: 'Significance', icon: 'target' },
		{ label: 'Current Owner', icon: 'user' },
	],
	suggestedFields: [
		f('Previous Owners', 'textarea', 'Whose hands has it passed through? Link with [[wikilinks]]…'),
		f('How It Is Used', 'textarea', 'Wielded, worn, read, traded — what does using it look like?'),
		f('Rumors & Legends', 'textarea', 'What do people believe about it that may not be true?'),
		f('Where It Must End Up', 'text', 'Its destination in the plot'),
	],
};

const RESEARCH_SPEC: EntityKindSpec = {
	kind: 'research',
	singular: 'Research Note',
	plural: 'Research',
	icon: 'magnifying-glass',
	fallbackIcon: '🔎',
	folderName: 'Research',
	calloutType: 'question',
	calloutTitle: 'Source at a Glance',
	tagline: 'What you’ve learned for the book — sources, facts, and quotes you can trust.',
	defaultName: 'Untitled Research Note',
	defaultFields: [
		f('Topic', 'text', 'What is this note about?'),
		f('Source', 'text', 'Book, article, website, interview, documentary…'),
		f('Link or Reference', 'text', 'URL, ISBN, page numbers — where to find it again'),
		f('Status', 'text', 'To read, reading, done, needs follow-up'),
		f('Reliability', 'text', 'How much do you trust this source?'),
		f('Image', 'image', 'Vault path to a reference image, map, or diagram'),
		f('Key Facts', 'textarea', 'The facts that matter, in your own words…'),
		f('Quotes', 'textarea', 'Word-for-word passages worth keeping — note the page…'),
		f('How It Shapes the Story', 'textarea', 'Which scenes, characters, or systems does this feed? Link with [[wikilinks]]…'),
		f('Open Questions', 'textarea', 'What do you still need to find out?'),
	],
	sections: [
		{ title: 'Source', icon: 'magnifying-glass', fields: ['Topic', 'Source', 'Link or Reference', 'Status', 'Reliability'] },
		{ title: 'Findings', icon: 'books', fields: ['Key Facts', 'Quotes'] },
		{ title: 'Story Impact', icon: 'flame', fields: ['How It Shapes the Story', 'Open Questions'] },
	],
};

const EVENT_SPEC: EntityKindSpec = {
	kind: 'event',
	singular: 'Event',
	plural: 'Historical Events',
	icon: 'calendar',
	fallbackIcon: '📅',
	folderName: 'Events',
	calloutType: 'info',
	calloutTitle: 'Event at a Glance',
	tagline: 'The moments that define your world — battles, discoveries, upheavals, turning points.',
	defaultName: 'Untitled Event',
	defaultFields: [
		f('Event Name', 'text', 'What is this event called?'),
		f('Date', 'storydate', 'When did it happen? Powers the Timeline’s world track.'),
		HOW_LONG_FIELD,
		f('End Date', 'storydate', 'When did it end? Leave empty if it is still going on in the story — the Timeline then runs it up to the story’s present.'),
		f('Location', 'text', 'Where did it take place? Link places with [[wikilinks]]…'),
		f('Type', 'text', 'Battle, natural disaster, discovery, betrayal, peace treaty…'),
		f('Key Participants', 'textarea', 'Who was involved? Link characters with [[wikilinks]]…'),
		f('Causes', 'textarea', 'What led to this event?'),
		f('What Happened', 'textarea', 'The event itself — the sequence, the turning point, the outcome…'),
		f('Immediate Consequences', 'textarea', 'What changed right after? Who was hurt or helped?'),
		f('Long-Term Impact', 'textarea', 'How does this ripple through your story and world? Which characters carry the weight?'),
		f('Image', 'image', 'Vault path to a related image, artifact, or scene'),
	],
	sections: [
		{ title: 'When & Where', icon: 'calendar', fields: ['Event Name', 'Date', 'How Long', 'End Date', 'Color', 'Location'] },
		{ title: 'The Event', icon: 'lightning', fields: ['Type', 'Key Participants', 'Causes', 'What Happened', 'Description'] },
		{ title: 'The Age', icon: 'hourglass', fields: ['What Defines This Age', 'How It Began', 'How It Ends'] },
		{ title: 'Aftermath', icon: 'waves', fields: ['Immediate Consequences', 'Long-Term Impact'] },
	],
	// A clean event is when, until when, and what — enough to sit on the Timeline.
	cleanSlateFields: [
		f('Date', 'storydate', 'When did it happen? Powers the Timeline’s world track.'),
		HOW_LONG_FIELD,
		f('End Date', 'storydate', 'When did it end? Leave empty if it is still going on in the story — the Timeline then runs it up to the story’s present.'),
		f('Description', 'textarea', 'What happens? Link characters and places with [[wikilinks]]…'),
	],
	extraFieldSets: [ERA_SHEET.guidedFields],
};

/** The eight kinds Plotverk ships with. Custom kinds merge on top at runtime. */
export const ENTITY_KINDS: Record<BuiltinEntityKind, EntityKindSpec> = {
	character: CHARACTER_SPEC,
	location: LOCATION_SPEC,
	scene: SCENE_SPEC,
	faction: FACTION_SPEC,
	system: SYSTEM_SPEC,
	item: ITEM_SPEC,
	research: RESEARCH_SPEC,
	event: EVENT_SPEC,
};

/**
 * Every spec the plugin ships, keyed by id: the original eight plus the kinds
 * added by the Codex restructure. Sidebar ORDER is not decided here — it comes
 * from CODEX_GROUPS (see BUILTIN_KIND_ORDER below).
 */
const SHIPPED_SPECS = new Map<EntityKind, EntityKindSpec>([
	...(Object.keys(ENTITY_KINDS) as BuiltinEntityKind[]).map((k) => [k, ENTITY_KINDS[k]] as const),
	...NEW_WORLDBUILDING_KINDS.map((s) => [s.kind, s] as const),
]);

/**
 * Built-in sidebar order — flattened from CODEX_GROUPS so the groups array is
 * the single source of truth. Kinds that still ship but are no longer surfaced
 * in the sidebar (scene, location, system, research) are simply absent here;
 * their specs stay registered so existing documents keep resolving.
 */
const BUILTIN_KIND_ORDER: EntityKind[] = CODEX_GROUPS.flatMap((g) => g.kinds);

// ─── Live registry (built-ins + custom kinds from settings) ──────────────────
// Defaults to the built-ins so pure imports and tests work with no setup;
// initKindRegistry() merges user-defined kinds once plugin settings load.

const registry = new Map<string, EntityKindSpec>();
let kindOrder: EntityKind[] = [];

function seedBuiltins(): void {
	registry.clear();
	// Register EVERY shipped spec — including retired ones (location, system,
	// research, scene) that no longer appear in the sidebar — so documents
	// written against them still resolve to a real spec instead of the fallback.
	for (const [k, spec] of SHIPPED_SPECS) {
		registry.set(k, { ...spec, builtin: true, displayShape: spec.displayShape ?? 'card' });
	}
	kindOrder = [...BUILTIN_KIND_ORDER];
}
seedBuiltins();

/**
 * Rebuild the live kind registry: the seven built-ins plus any user-defined
 * custom kinds from settings. Called once on plugin load (and again whenever
 * custom kinds change). Custom kinds may NOT override a built-in id — built-ins
 * always win so existing documents keep resolving. Custom kinds are inserted
 * before 'scene' so worldbuilding kinds stay grouped above the manuscript.
 */
export function initKindRegistry(customKinds: EntityKindSpec[] = []): void {
	seedBuiltins();
	const world = kindOrder.filter((k) => k !== 'scene');
	for (const def of customKinds) {
		if (!def?.kind || registry.has(def.kind)) continue; // skip blanks + built-in collisions
		registry.set(def.kind, { ...def, builtin: false, displayShape: def.displayShape ?? 'card' });
		world.push(def.kind);
	}
	kindOrder = kindOrder.includes('scene') ? [...world, 'scene'] : world;
}

/** Kinds in Codex sidebar order (built-ins + custom). Call at runtime — never cache at module load. */
export function getCodexKindOrder(): EntityKind[] {
	return [...kindOrder];
}

/**
 * The Codex sidebar's two-level structure: the nine shipped groups, plus a
 * trailing "Your Own" group holding any user-defined custom kinds. Groups with
 * no registered kinds are dropped, so a group never renders empty.
 * Call at runtime — the custom-kind tail changes when settings load.
 */
export function getCodexGroups(): CodexGroupSpec[] {
	const grouped = new Set(CODEX_GROUPS.flatMap((g) => g.kinds));
	const groups = CODEX_GROUPS
		.map((g) => ({ ...g, kinds: g.kinds.filter((k) => registry.has(k)) }))
		.filter((g) => g.kinds.length > 0);

	const custom = kindOrder.filter((k) => !grouped.has(k));
	if (custom.length > 0) {
		groups.push({
			id: 'custom',
			label: 'Your Own',
			info: 'The categories you have created yourself.',
			icon: 'sparkles',
			fallbackIcon: '✨',
			kinds: custom,
		});
	}
	return groups;
}

/** True if `kind` is a registered built-in or custom kind. */
export function hasKind(kind: string): boolean {
	return registry.has(kind);
}

/**
 * Every registered kind id — built-ins (retired ones included, so old documents
 * still resolve) plus custom kinds. This is the one list to iterate when a
 * feature must cover "every kind"; `ENTITY_KINDS` holds only the original eight.
 */
export function registeredKinds(): EntityKind[] {
	return [...registry.keys()];
}

/**
 * Shown for a sheet that has no `storygrid-type` of its own and sits outside
 * every kind's folder. Deliberately not a registered kind: it resolves to the
 * generic spec, so such a sheet is displayed as a plain entry instead of being
 * mislabelled (and re-saved) as a Character.
 */
export const UNTYPED_KIND = 'entry';

/** Fallback spec for an unknown kind id (a stale doc, or a custom kind referenced before its def loaded). Never returns undefined. */
function genericKindSpec(kind: EntityKind): EntityKindSpec {
	const label = String(kind).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Entry';
	return {
		kind,
		singular: label,
		plural: label,
		icon: 'note-pencil',
		fallbackIcon: '•',
		folderName: label,
		calloutType: 'note',
		calloutTitle: `${label} at a Glance`,
		tagline: '',
		defaultName: `Untitled ${label}`,
		defaultFields: [f('Name', 'text', 'What is this called?')],
		displayShape: 'card',
		builtin: false,
	};
}

export function getKindSpec(kind: EntityKind): EntityKindSpec {
	return registry.get(kind) ?? genericKindSpec(kind);
}

/** Instantiate a spec's field list into editable CharacterField values. */
export function instantiateFields(specs: EntityFieldSpec[], name: string, nameLabels: string[] = ['Full Name', 'Name', 'Title']): CharacterField[] {
	return specs.map((s, i) => ({
		id: generateId(),
		label: s.label,
		type: s.type,
		value: i === 0 && nameLabels.includes(s.label) ? name : defaultValueForType(s.type, s.config),
		...(s.config ? { config: { ...s.config } } : {}),
	}));
}

export interface GroupedSection {
	title: string;
	icon: string;
	fields: CharacterField[];
}

/**
 * Group editable fields into the kind's editor sections. Image fields are
 * excluded — the first is the portrait in the rail, and any others render as
 * "Additional images" rows in that same rail (see EntityModal.renderRail),
 * not in a section. Fields carrying a `category` (set by a template or the
 * custom-field creator) group into their own section, in first-appearance
 * order, after the kind's built-in spec sections. Anything left over —
 * custom fields with no category, preset fields — falls into a trailing
 * "More" group so nothing disappears.
 */
export function groupFieldsIntoSections(kind: EntityKind, fields: CharacterField[]): GroupedSection[] {
	const spec = getKindSpec(kind);
	const editable = fields.filter((f) => f.type !== 'image');
	const placed = new Set<string>();
	const out: GroupedSection[] = [];

	for (const section of spec.sections ?? []) {
		const inSection = editable.filter((f) => section.fields.includes(f.label) && !placed.has(f.id));
		if (inSection.length === 0) continue;
		for (const f of inSection) placed.add(f.id);
		out.push({ title: section.title, icon: section.icon, fields: inSection });
	}

	const categoryOrder: string[] = [];
	for (const f of editable) {
		if (f.category && !placed.has(f.id) && !categoryOrder.includes(f.category)) categoryOrder.push(f.category);
	}
	for (const category of categoryOrder) {
		const inCategory = editable.filter((f) => f.category === category && !placed.has(f.id));
		if (inCategory.length === 0) continue;
		for (const f of inCategory) placed.add(f.id);
		// A field filed under the name of a built-in section joins that section
		// rather than opening a second one with the same title.
		const existing = out.find((s) => s.title === category);
		if (existing) existing.fields.push(...inCategory);
		else out.push({ title: category, icon: iconForCustomLabel(category), fields: inCategory });
	}

	const leftover = editable.filter((f) => !placed.has(f.id));
	if (leftover.length > 0) {
		out.push({ title: out.length > 0 ? 'More' : `${spec.singular} Fields`, icon: 'plus-circle', fields: leftover });
	}
	return out;
}

/** One branch of the "pick a ready-made field" tree: a category and its fields. */
export interface CatalogCategory {
	title: string;
	fields: EntityFieldSpec[];
}

/**
 * The category → field tree offered when someone adds a ready-made field.
 *
 * Everything here comes from fields this kind already defines: each built-in
 * section contributes the fields it owns, and the kind's suggestions form one
 * more category. Nothing is invented — when a richer taxonomy is supplied it
 * becomes additional categories and this function is where it plugs in.
 *
 * Fields already on the sheet are filtered out, so the tree only ever offers
 * something you can actually add.
 */
export function fieldCatalogForKind(kind: EntityKind, usedLabels: string[] = []): CatalogCategory[] {
	const spec = getKindSpec(kind);
	const used = new Set(usedLabels.map((l) => l.toLowerCase()));
	const byLabel = new Map(spec.defaultFields.map((f) => [f.label, f]));
	const out: CatalogCategory[] = [];

	for (const section of spec.sections ?? []) {
		const fields = section.fields
			.map((label) => byLabel.get(label))
			.filter((f): f is EntityFieldSpec => !!f && !used.has(f.label.toLowerCase()));
		if (fields.length > 0) out.push({ title: section.title, fields });
	}

	// User-supplied attribute categories (see attribute-catalog.ts).
	for (const category of attributeCategoriesFor(kind)) {
		const fields = category.fields.filter((f) => !used.has(f.label.toLowerCase()));
		if (fields.length > 0) out.push({ title: category.title, fields });
	}

	const suggested = (spec.suggestedFields ?? []).filter((f) => !used.has(f.label.toLowerCase()));
	if (suggested.length > 0) out.push({ title: 'Suggested', fields: suggested });

	return out;
}

/** Look up the guided prompt for a field label within a kind (including presets and suggestions). */
/** A clean slate's one text box, for kinds whose template has no Notes of its own (see cleanSlateFieldSpecs). */
export const CLEAN_SLATE_NOTES: EntityFieldSpec = { label: 'Notes', type: 'textarea', prompt: 'Write anything here…' };

export function getFieldPrompt(kind: EntityKind, label: string): string {
	const spec = getKindSpec(kind);
	const all = [
		...spec.defaultFields,
		...(spec.presets ?? []).flatMap((p) => p.fields),
		...(spec.suggestedFields ?? []),
		...(spec.cleanSlateFields ?? []),
		...(spec.extraFieldSets ?? []).flat(),
		CLEAN_SLATE_NOTES,
	];
	return all.find((fs) => fs.label === label)?.prompt ?? '';
}

/**
 * Pick a fitting icon for a custom field/section label so user-added sections
 * never look second-class on the detail page. Falls back to a neutral pencil.
 */
export function iconForCustomLabel(label: string): string {
	const l = label.toLowerCase();
	if (/famil|parent|sibling|relation|friend|ally|allies/.test(l)) return 'users';
	if (/memor|past|history|childhood|youth/.test(l)) return 'clock';
	if (/secret|hidden|lie|private/.test(l)) return 'lock';
	if (/quirk|habit|routine|manner/.test(l)) return 'sparkles';
	if (/fear|ghost|haunt|nightmare/.test(l)) return 'ghost';
	if (/belie|value|faith|creed|philosoph/.test(l)) return 'compass';
	if (/posses|item|object|carry|treasure/.test(l)) return 'gem';
	if (/goal|want|ambition|dream|matter/.test(l)) return 'target';
	if (/love|heart|romance|partner/.test(l)) return 'heart';
	if (/danger|threat|weakness|flaw|warning/.test(l)) return 'warning';
	if (/strength|power|skill|abilit/.test(l)) return 'shield';
	if (/place|location|home|land|map/.test(l)) return 'map-pin';
	if (/book|read|stor|lore|legend|rumor/.test(l)) return 'book-open';
	return 'note-pencil';
}
