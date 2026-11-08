import type { CharacterField } from '../grid-data';
import type { EntityKind, EntityKindSpec, EntityFieldSpec } from './entity-kinds';

/**
 * The worldbuilding kinds added in the 2026-08 Codex restructure, plus the
 * two-level group registry the Codex sidebar renders from.
 *
 * Types are imported with `import type` on purpose: entity-kinds.ts imports the
 * specs from this file, so a value import would form a runtime circular
 * dependency. Type-only imports are erased at compile time and cannot cycle.
 *
 * Kinds that already shipped (character, faction, item, event, research) are
 * NOT redefined here — they keep their existing specs and are referenced by id
 * from CODEX_GROUPS below.
 */

const f = (label: string, type: CharacterField['type'], prompt: string): EntityFieldSpec => ({ label, type, prompt });

// ─── Places & Locations ──────────────────────────────────────────────────────

const REGION_SPEC: EntityKindSpec = {
	kind: 'region',
	singular: 'Region',
	plural: 'Regions',
	icon: 'globe',
	fallbackIcon: '🗺️',
	folderName: 'Regions',
	calloutType: 'info',
	calloutTitle: 'Region at a Glance',
	tagline: 'Large areas like continents, kingdoms, or planetary sectors.',
	defaultName: 'Untitled Region',
	defaultFields: [
		f('Name', 'text', 'What is this region called?'),
		f('Type', 'text', 'Continent, kingdom, province, sector, wasteland…'),
		f('Ruled By', 'text', 'Who holds power here? Link with [[wikilinks]]'),
		f('Climate', 'text', 'Temperate, arid, frozen, storm-locked…'),
		f('Image', 'image', 'Vault path to a map or landscape image'),
		f('Geography', 'textarea', 'What does the land itself look like — borders, barriers, terrain…'),
		f('People & Culture', 'textarea', 'Who lives here, and what marks them as of this place?'),
		f('Tensions', 'textarea', 'What is contested here? Borders, resources, old grudges…'),
		f('Notes', 'textarea', 'Anything else worth remembering'),
	],
	sections: [
		{ title: 'Essentials', icon: 'globe', fields: ['Name', 'Type', 'Ruled By', 'Climate'] },
		{ title: 'The Land', icon: 'map-pin', fields: ['Geography', 'People & Culture'] },
		{ title: 'Conflict & Notes', icon: 'flame', fields: ['Tensions', 'Notes'] },
	],
};

const SETTLEMENT_SPEC: EntityKindSpec = {
	kind: 'settlement',
	singular: 'Settlement',
	plural: 'Settlements',
	icon: 'map-pin',
	fallbackIcon: '🏙️',
	folderName: 'Settlements',
	calloutType: 'info',
	calloutTitle: 'Settlement at a Glance',
	tagline: 'Populated hubs like cities, towns, villages, or space stations.',
	defaultName: 'Untitled Settlement',
	defaultFields: [
		f('Name', 'text', 'What is this place called?'),
		f('Type', 'text', 'City, town, village, outpost, station…'),
		f('Region', 'text', 'Where does it sit? Link with [[wikilinks]]'),
		f('Population', 'text', 'Roughly how many people live here?'),
		f('Ruled By', 'text', 'Who runs it? Link with [[wikilinks]]'),
		f('Image', 'image', 'Vault path to an image of this settlement'),
		f('First Impression', 'textarea', 'What hits you first — the smell, the noise, the skyline?'),
		f('Districts & Layout', 'textarea', 'How is it organised? Where does money live, where does trouble?'),
		f('Economy', 'textarea', 'What does it make, sell, or steal to survive?'),
		f('Trouble', 'textarea', 'What is going wrong here that the story can use?'),
	],
	sections: [
		{ title: 'Essentials', icon: 'map-pin', fields: ['Name', 'Type', 'Region', 'Population', 'Ruled By'] },
		{ title: 'The Place', icon: 'note-pencil', fields: ['First Impression', 'Districts & Layout'] },
		{ title: 'Life & Trouble', icon: 'flame', fields: ['Economy', 'Trouble'] },
	],
	heroTitle: 'At a Glance',
	heroFields: [
		{ label: 'Type', icon: 'map-pin' },
		{ label: 'Ruled By', icon: 'shield' },
	],
};

const ZONE_SPEC: EntityKindSpec = {
	kind: 'zone',
	singular: 'Neighborhood',
	plural: 'Neighborhoods & Zones',
	icon: 'squares-four',
	fallbackIcon: '🏘️',
	folderName: 'Neighborhoods',
	calloutType: 'info',
	calloutTitle: 'Zone at a Glance',
	tagline: 'Local areas like districts, city blocks, or military bases.',
	defaultName: 'Untitled Zone',
	defaultFields: [
		f('Name', 'text', 'What is this district or zone called?'),
		f('Type', 'text', 'District, block, quarter, base, compound…'),
		f('Part Of', 'text', 'Which settlement contains it? Link with [[wikilinks]]'),
		f('Controlled By', 'text', 'Who holds this ground? Link with [[wikilinks]]'),
		f('Image', 'image', 'Vault path to an image of this area'),
		f('Atmosphere', 'textarea', 'What does it feel like to walk through here?'),
		f('Who Lives Here', 'textarea', 'The people of this zone — class, trade, reputation…'),
		f('Key Locations', 'textarea', 'Specific buildings and spots that matter. Link with [[wikilinks]]'),
		f('Notes', 'textarea', 'Anything else worth remembering'),
	],
	sections: [
		{ title: 'Essentials', icon: 'squares-four', fields: ['Name', 'Type', 'Part Of', 'Controlled By'] },
		{ title: 'The Area', icon: 'note-pencil', fields: ['Atmosphere', 'Who Lives Here'] },
		{ title: 'Points of Interest', icon: 'map-pin', fields: ['Key Locations', 'Notes'] },
	],
};

const LANDMARK_SPEC: EntityKindSpec = {
	kind: 'landmark',
	singular: 'Landmark',
	plural: 'Landmarks',
	icon: 'flag',
	fallbackIcon: '🗿',
	folderName: 'Landmarks',
	calloutType: 'info',
	calloutTitle: 'Landmark at a Glance',
	tagline: 'Points of interest like ruins, monuments, or natural wonders.',
	defaultName: 'Untitled Landmark',
	defaultFields: [
		f('Name', 'text', 'What is this landmark called?'),
		f('Type', 'text', 'Ruin, monument, natural wonder, tower, shrine…'),
		f('Location', 'text', 'Where is it? Link with [[wikilinks]]'),
		f('Age', 'text', 'How old is it? Who built it, and when?'),
		f('Image', 'image', 'Vault path to an image of this landmark'),
		f('Appearance', 'textarea', 'What does it look like as you approach?'),
		f('History', 'textarea', 'What happened here? Why does it still stand?'),
		f('Significance', 'textarea', 'What does it mean to the people who live near it?'),
		f('Secrets', 'textarea', 'What does it hide that the story will uncover?'),
	],
	sections: [
		{ title: 'Essentials', icon: 'flag', fields: ['Name', 'Type', 'Location', 'Age'] },
		{ title: 'Description', icon: 'note-pencil', fields: ['Appearance', 'History'] },
		{ title: 'Meaning & Secrets', icon: 'lock', fields: ['Significance', 'Secrets'] },
	],
};

// ─── Groups & Factions ───────────────────────────────────────────────────────

const BLOODLINE_SPEC: EntityKindSpec = {
	kind: 'bloodline',
	singular: 'Family',
	plural: 'Families & Bloodlines',
	icon: 'tree-view',
	fallbackIcon: '🌳',
	folderName: 'Families',
	calloutType: 'tip',
	calloutTitle: 'Family at a Glance',
	tagline: 'Family trees, noble houses, and dynasties.',
	defaultName: 'Untitled Family',
	defaultFields: [
		f('Family Name', 'text', 'What is this house or bloodline called?'),
		f('Seat', 'text', 'Where are they from? Link with [[wikilinks]]'),
		f('Head of Family', 'text', 'Who leads them now? Link with [[wikilinks]]'),
		f('Status', 'text', 'Ruling, fading, exiled, newly risen…'),
		f('Image', 'image', 'Vault path to a crest, sigil, or portrait'),
		f('Members', 'textarea', 'Who belongs to this line? Link characters with [[wikilinks]]'),
		f('Origins', 'textarea', 'How did this family come to be what it is?'),
		f('Reputation', 'textarea', 'What do others say about them — earned or not?'),
		f('Inheritance & Feuds', 'textarea', 'What passes down the line — titles, debts, curses, grudges?'),
	],
	sections: [
		{ title: 'Essentials', icon: 'tree-view', fields: ['Family Name', 'Seat', 'Head of Family', 'Status'] },
		{ title: 'The Line', icon: 'users', fields: ['Members', 'Origins'] },
		{ title: 'Legacy', icon: 'flame', fields: ['Reputation', 'Inheritance & Feuds'] },
	],
};

const GOVERNMENT_SPEC: EntityKindSpec = {
	kind: 'government',
	singular: 'Government',
	plural: 'Government & Law',
	icon: 'columns',
	fallbackIcon: '🏛️',
	folderName: 'Government',
	calloutType: 'abstract',
	calloutTitle: 'Government at a Glance',
	tagline: 'Political structures, legal systems, and how laws are enforced.',
	defaultName: 'Untitled Government',
	defaultFields: [
		f('Name', 'text', 'What is this government or legal system called?'),
		f('Form', 'text', 'Monarchy, republic, theocracy, council, junta…'),
		f('Jurisdiction', 'text', 'Where does its authority reach? Link with [[wikilinks]]'),
		f('Head of State', 'text', 'Who sits at the top? Link with [[wikilinks]]'),
		f('Image', 'image', 'Vault path to a seal, banner, or building'),
		f('How Power Is Held', 'textarea', 'Inherited, elected, seized, bought — and how is it kept?'),
		f('The Laws', 'textarea', 'What is forbidden here that would surprise an outsider?'),
		f('Enforcement', 'textarea', 'Who enforces the law, and how far will they go?'),
		f('Corruption & Cracks', 'textarea', 'Where does the system fail, and who profits from that?'),
	],
	sections: [
		{ title: 'Essentials', icon: 'columns', fields: ['Name', 'Form', 'Jurisdiction', 'Head of State'] },
		{ title: 'Power & Law', icon: 'shield', fields: ['How Power Is Held', 'The Laws'] },
		{ title: 'In Practice', icon: 'flame', fields: ['Enforcement', 'Corruption & Cracks'] },
	],
};

const MILITARY_SPEC: EntityKindSpec = {
	kind: 'military',
	singular: 'Military Force',
	plural: 'Military & Armies',
	icon: 'shield',
	fallbackIcon: '⚔️',
	folderName: 'Military',
	calloutType: 'danger',
	calloutTitle: 'Force at a Glance',
	tagline: 'Armed forces, defensive forts, ranks, and weaponry.',
	defaultName: 'Untitled Force',
	defaultFields: [
		f('Name', 'text', 'What is this force called?'),
		f('Type', 'text', 'Standing army, navy, militia, order, mercenary company…'),
		f('Serves', 'text', 'Who commands them? Link with [[wikilinks]]'),
		f('Strength', 'text', 'How many, and how well equipped?'),
		f('Image', 'image', 'Vault path to a banner, uniform, or weapon'),
		f('Ranks & Structure', 'textarea', 'How is it organised, from the top down?'),
		f('Weapons & Tactics', 'textarea', 'How do they actually fight?'),
		f('Strongholds', 'textarea', 'Forts, bases, and ground they hold. Link with [[wikilinks]]'),
		f('Weaknesses', 'textarea', 'What would break them — supply, morale, a single leader?'),
	],
	sections: [
		{ title: 'Essentials', icon: 'shield', fields: ['Name', 'Type', 'Serves', 'Strength'] },
		{ title: 'How They Fight', icon: 'flame', fields: ['Ranks & Structure', 'Weapons & Tactics'] },
		{ title: 'Ground & Weakness', icon: 'warning', fields: ['Strongholds', 'Weaknesses'] },
	],
};

const SOCIAL_CLASS_SPEC: EntityKindSpec = {
	kind: 'social-class',
	singular: 'Social Class',
	plural: 'Social Classes',
	icon: 'chart-bar',
	fallbackIcon: '👑',
	folderName: 'Social Classes',
	calloutType: 'abstract',
	calloutTitle: 'Class at a Glance',
	tagline: 'How wealth, rank, and power are split among the population.',
	defaultName: 'Untitled Class',
	defaultFields: [
		f('Name', 'text', 'What is this class or caste called?'),
		f('Rank', 'text', 'Where does it sit — top, middle, bottom, outside?'),
		f('Share of Population', 'text', 'How many people belong to it?'),
		f('Marked By', 'text', 'Dress, speech, brand, papers — how are they identified?'),
		f('Image', 'image', 'Vault path to a representative image'),
		f('Daily Life', 'textarea', 'What does an ordinary day look like for them?'),
		f('Rights & Restrictions', 'textarea', 'What may they do that others may not — and what is denied them?'),
		f('Mobility', 'textarea', 'Can anyone rise or fall between classes? At what cost?'),
		f('Resentments', 'textarea', 'Who do they look down on, and who is coming for them?'),
	],
	sections: [
		{ title: 'Essentials', icon: 'chart-bar', fields: ['Name', 'Rank', 'Share of Population', 'Marked By'] },
		{ title: 'Life & Law', icon: 'note-pencil', fields: ['Daily Life', 'Rights & Restrictions'] },
		{ title: 'Pressure', icon: 'flame', fields: ['Mobility', 'Resentments'] },
	],
};

// ─── Nature & Universe ───────────────────────────────────────────────────────

const SPACE_SPEC: EntityKindSpec = {
	kind: 'space',
	singular: 'Celestial Body',
	plural: 'Space & Planets',
	icon: 'planet',
	fallbackIcon: '🪐',
	folderName: 'Space',
	calloutType: 'info',
	calloutTitle: 'Body at a Glance',
	tagline: 'Suns, moons, stars, and constellations.',
	defaultName: 'Untitled Body',
	defaultFields: [
		f('Name', 'text', 'What is it called?'),
		f('Type', 'text', 'Sun, moon, planet, star, constellation, comet…'),
		f('Orbits', 'text', 'What does it circle, or what circles it?'),
		f('Visible From', 'text', 'Where in your world can it be seen? Link with [[wikilinks]]'),
		f('Image', 'image', 'Vault path to an image or star chart'),
		f('Appearance', 'textarea', 'What does it look like from the ground?'),
		f('Effects on the World', 'textarea', 'Tides, seasons, madness, magic — what does it change?'),
		f('Beliefs', 'textarea', 'What do people think it means when it rises or vanishes?'),
		f('Notes', 'textarea', 'Anything else worth remembering'),
	],
	sections: [
		{ title: 'Essentials', icon: 'planet', fields: ['Name', 'Type', 'Orbits', 'Visible From'] },
		{ title: 'Description', icon: 'note-pencil', fields: ['Appearance', 'Effects on the World'] },
		{ title: 'Meaning', icon: 'sparkles', fields: ['Beliefs', 'Notes'] },
	],
};

const TERRAIN_SPEC: EntityKindSpec = {
	kind: 'terrain',
	singular: 'Terrain',
	plural: 'Land & Terrains',
	icon: 'globe',
	fallbackIcon: '⛰️',
	folderName: 'Terrains',
	calloutType: 'info',
	calloutTitle: 'Terrain at a Glance',
	tagline: 'Geographical features like mountains, forests, and deserts.',
	defaultName: 'Untitled Terrain',
	defaultFields: [
		f('Name', 'text', 'What is this feature called?'),
		f('Type', 'text', 'Mountain range, forest, desert, marsh, canyon…'),
		f('Region', 'text', 'Where is it? Link with [[wikilinks]]'),
		f('Passable?', 'text', 'Can people cross it, and how hard is it?'),
		f('Image', 'image', 'Vault path to a landscape image'),
		f('Appearance', 'textarea', 'What does it look and sound like to stand in?'),
		f('Dangers', 'textarea', 'What kills the unprepared here?'),
		f('Resources', 'textarea', 'What can be taken from this land — and who wants it?'),
		f('Story Use', 'textarea', 'Which scenes happen here? Link with [[wikilinks]]'),
	],
	sections: [
		{ title: 'Essentials', icon: 'globe', fields: ['Name', 'Type', 'Region', 'Passable?'] },
		{ title: 'The Land', icon: 'note-pencil', fields: ['Appearance', 'Dangers'] },
		{ title: 'Value & Use', icon: 'gem', fields: ['Resources', 'Story Use'] },
	],
};

const WATER_SPEC: EntityKindSpec = {
	kind: 'water-body',
	singular: 'Water Body',
	plural: 'Water Bodies',
	icon: 'compass',
	fallbackIcon: '🌊',
	folderName: 'Waters',
	calloutType: 'info',
	calloutTitle: 'Water at a Glance',
	tagline: 'Oceans, seas, rivers, and bays.',
	defaultName: 'Untitled Water',
	defaultFields: [
		f('Name', 'text', 'What is this water called?'),
		f('Type', 'text', 'Ocean, sea, river, lake, bay, strait…'),
		f('Connects', 'text', 'What does it touch or join? Link with [[wikilinks]]'),
		f('Navigable?', 'text', 'Can it be sailed, forded, or crossed?'),
		f('Image', 'image', 'Vault path to an image or chart'),
		f('Character', 'textarea', 'Calm, treacherous, tidal, frozen half the year…'),
		f('Life Within', 'textarea', 'What lives in it — food, threat, or legend?'),
		f('Who Uses It', 'textarea', 'Trade, fishing, war, pilgrimage. Link with [[wikilinks]]'),
		f('Dangers & Lore', 'textarea', 'Storms, wrecks, and the stories sailors tell'),
	],
	sections: [
		{ title: 'Essentials', icon: 'compass', fields: ['Name', 'Type', 'Connects', 'Navigable?'] },
		{ title: 'The Water', icon: 'note-pencil', fields: ['Character', 'Life Within'] },
		{ title: 'Use & Danger', icon: 'warning', fields: ['Who Uses It', 'Dangers & Lore'] },
	],
};

const WEATHER_SPEC: EntityKindSpec = {
	kind: 'weather',
	singular: 'Weather Pattern',
	plural: 'Weather & Seasons',
	icon: 'sparkles',
	fallbackIcon: '🌦️',
	folderName: 'Weather',
	calloutType: 'info',
	calloutTitle: 'Weather at a Glance',
	tagline: 'Climates, weather patterns, and temperature shifts.',
	defaultName: 'Untitled Weather',
	defaultFields: [
		f('Name', 'text', 'What is this season or weather called?'),
		f('Type', 'text', 'Season, storm, drought, monsoon, magical anomaly…'),
		f('Where', 'text', 'Which regions does it affect? Link with [[wikilinks]]'),
		f('When', 'text', 'How often, and for how long?'),
		f('Image', 'image', 'Vault path to a representative image'),
		f('What It Is Like', 'textarea', 'What does living through it feel like?'),
		f('Effects', 'textarea', 'What does it do to travel, crops, trade, tempers?'),
		f('How People Cope', 'textarea', 'Shelters, rituals, stockpiles, migrations…'),
		f('Story Use', 'textarea', 'Which scenes does this weather shape?'),
	],
	sections: [
		{ title: 'Essentials', icon: 'sparkles', fields: ['Name', 'Type', 'Where', 'When'] },
		{ title: 'The Weather', icon: 'note-pencil', fields: ['What It Is Like', 'Effects'] },
		{ title: 'Living With It', icon: 'shield', fields: ['How People Cope', 'Story Use'] },
	],
};

const CALENDAR_SPEC: EntityKindSpec = {
	kind: 'calendar',
	singular: 'Calendar',
	plural: 'Calendars & Time',
	icon: 'calendar',
	fallbackIcon: '🕰️',
	folderName: 'Calendars',
	calloutType: 'abstract',
	calloutTitle: 'Calendar at a Glance',
	tagline: 'How your world measures days, months, and years.',
	defaultName: 'Untitled Calendar',
	defaultFields: [
		f('Name', 'text', 'What is this calendar or reckoning called?'),
		f('Used By', 'text', 'Who counts time this way? Link with [[wikilinks]]'),
		f('Year Length', 'text', 'How many days, months, or cycles in a year?'),
		f('Epoch', 'text', 'What event does year one count from?'),
		f('Image', 'image', 'Vault path to a calendar chart or diagram'),
		f('Structure', 'textarea', 'Months, weeks, days — what are they called and how long?'),
		f('Holy Days & Festivals', 'textarea', 'Which dates matter, and why?'),
		f('Rival Reckonings', 'textarea', 'Who counts differently, and what does that cause?'),
		f('Notes', 'textarea', 'Anything else worth remembering'),
	],
	sections: [
		{ title: 'Essentials', icon: 'calendar', fields: ['Name', 'Used By', 'Year Length', 'Epoch'] },
		{ title: 'How It Works', icon: 'clock', fields: ['Structure', 'Holy Days & Festivals'] },
		{ title: 'Friction', icon: 'flame', fields: ['Rival Reckonings', 'Notes'] },
	],
};

// ─── Creatures & Life ────────────────────────────────────────────────────────

const SPECIES_SPEC: EntityKindSpec = {
	kind: 'species',
	singular: 'Species',
	plural: 'Species & Peoples',
	icon: 'users',
	fallbackIcon: '🧝',
	folderName: 'Species',
	calloutType: 'tip',
	calloutTitle: 'Species at a Glance',
	tagline: 'Intelligent species, their biology, and traits.',
	defaultName: 'Untitled Species',
	defaultFields: [
		f('Name', 'text', 'What are they called — by themselves, and by others?'),
		f('Homeland', 'text', 'Where are they from? Link with [[wikilinks]]'),
		f('Lifespan', 'text', 'How long do they live?'),
		f('Population', 'text', 'How many are there — thriving, rare, nearly gone?'),
		f('Image', 'image', 'Vault path to an image of this species'),
		f('Appearance', 'textarea', 'What do they look like? What would you notice first?'),
		f('Biology & Abilities', 'textarea', 'What can their bodies do that a human body cannot?'),
		f('Society', 'textarea', 'How do they live together — family, hierarchy, ritual?'),
		f('Relations', 'textarea', 'Who are their allies and enemies? Link with [[wikilinks]]'),
	],
	sections: [
		{ title: 'Essentials', icon: 'users', fields: ['Name', 'Homeland', 'Lifespan', 'Population'] },
		{ title: 'Body & Mind', icon: 'note-pencil', fields: ['Appearance', 'Biology & Abilities'] },
		{ title: 'Their World', icon: 'globe', fields: ['Society', 'Relations'] },
	],
};

const MONSTER_SPEC: EntityKindSpec = {
	kind: 'monster',
	singular: 'Monster',
	plural: 'Monsters & Beasts',
	icon: 'ghost',
	fallbackIcon: '👹',
	folderName: 'Monsters',
	calloutType: 'danger',
	calloutTitle: 'Monster at a Glance',
	tagline: 'Supernatural creatures, predators, and magical threats.',
	defaultName: 'Untitled Monster',
	defaultFields: [
		f('Name', 'text', 'What is it called?'),
		f('Type', 'text', 'Predator, undead, spirit, construct, aberration…'),
		f('Habitat', 'text', 'Where is it found? Link with [[wikilinks]]'),
		f('Threat Level', 'text', 'Nuisance, deadly, army-ending?'),
		f('Image', 'image', 'Vault path to an image of this creature'),
		f('Appearance', 'textarea', 'What does it look like — and what does it sound like first?'),
		f('Behaviour', 'textarea', 'How does it hunt, hide, or lure?'),
		f('Weaknesses', 'textarea', 'What can actually stop it?'),
		f('Lore', 'textarea', 'What do people believe about it that is wrong?'),
	],
	sections: [
		{ title: 'Essentials', icon: 'ghost', fields: ['Name', 'Type', 'Habitat', 'Threat Level'] },
		{ title: 'The Creature', icon: 'note-pencil', fields: ['Appearance', 'Behaviour'] },
		{ title: 'Fighting It', icon: 'shield', fields: ['Weaknesses', 'Lore'] },
	],
};

const WILDLIFE_SPEC: EntityKindSpec = {
	kind: 'wildlife',
	singular: 'Plant or Animal',
	plural: 'Plants & Wildlife',
	icon: 'tree-view',
	fallbackIcon: '🌿',
	folderName: 'Wildlife',
	calloutType: 'tip',
	calloutTitle: 'Life at a Glance',
	tagline: 'Ordinary animals, crops, and vegetation.',
	defaultName: 'Untitled Plant or Animal',
	defaultFields: [
		f('Name', 'text', 'What is it called?'),
		f('Type', 'text', 'Animal, crop, tree, herb, fungus…'),
		f('Found In', 'text', 'Where does it grow or live? Link with [[wikilinks]]'),
		f('Common or Rare?', 'text', 'How easily is it found?'),
		f('Image', 'image', 'Vault path to an image'),
		f('Description', 'textarea', 'What does it look like?'),
		f('Uses', 'textarea', 'Food, medicine, poison, dye, labour — what is it good for?'),
		f('Dangers', 'textarea', 'What happens if it is handled or eaten wrongly?'),
		f('Notes', 'textarea', 'Anything else worth remembering'),
	],
	sections: [
		{ title: 'Essentials', icon: 'tree-view', fields: ['Name', 'Type', 'Found In', 'Common or Rare?'] },
		{ title: 'Description', icon: 'note-pencil', fields: ['Description', 'Uses'] },
		{ title: 'Caution & Notes', icon: 'warning', fields: ['Dangers', 'Notes'] },
	],
};

const ILLNESS_SPEC: EntityKindSpec = {
	kind: 'illness',
	singular: 'Illness',
	plural: 'Illnesses & Conditions',
	icon: 'warning',
	fallbackIcon: '🦠',
	folderName: 'Illnesses',
	calloutType: 'danger',
	calloutTitle: 'Condition at a Glance',
	tagline: 'Plagues, magical curses, and medical states.',
	defaultName: 'Untitled Illness',
	defaultFields: [
		f('Name', 'text', 'What is it called?'),
		f('Type', 'text', 'Plague, curse, chronic condition, poison, madness…'),
		f('Spreads By', 'text', 'How is it caught or inflicted?'),
		f('Curable?', 'text', 'Is there a cure, and who has it?'),
		f('Image', 'image', 'Vault path to a related image'),
		f('Symptoms', 'textarea', 'What does it do to the body and mind, in order?'),
		f('Course', 'textarea', 'How fast does it move? What is the end?'),
		f('Treatment', 'textarea', 'What helps, what only seems to help?'),
		f('Social Response', 'textarea', 'How are the afflicted treated — pitied, hidden, burned?'),
	],
	sections: [
		{ title: 'Essentials', icon: 'warning', fields: ['Name', 'Type', 'Spreads By', 'Curable?'] },
		{ title: 'The Illness', icon: 'note-pencil', fields: ['Symptoms', 'Course'] },
		{ title: 'Response', icon: 'users', fields: ['Treatment', 'Social Response'] },
	],
};

// ─── Systems & Rules ─────────────────────────────────────────────────────────

const MONEY_SPEC: EntityKindSpec = {
	kind: 'money-trade',
	singular: 'Economy',
	plural: 'Money & Trade',
	icon: 'gem',
	fallbackIcon: '💰',
	folderName: 'Money & Trade',
	calloutType: 'abstract',
	calloutTitle: 'Economy at a Glance',
	tagline: 'Currencies, commerce, taxes, and trade routes.',
	defaultName: 'Untitled Economy',
	defaultFields: [
		f('Name', 'text', 'What is this currency or trade system called?'),
		f('Used By', 'text', 'Who trades this way? Link with [[wikilinks]]'),
		f('Currency', 'text', 'Coins, credits, barter, favours…'),
		f('Backed By', 'text', 'What gives it value — metal, crown, faith, force?'),
		f('Image', 'image', 'Vault path to a coin, note, or ledger image'),
		f('What Is Traded', 'textarea', 'The goods that actually move, and who wants them'),
		f('Trade Routes', 'textarea', 'How goods travel, and what threatens the journey'),
		f('Taxes & Debt', 'textarea', 'Who takes a cut, and what happens if you cannot pay?'),
		f('Black Market', 'textarea', 'What is traded in the dark, and by whom?'),
	],
	sections: [
		{ title: 'Essentials', icon: 'gem', fields: ['Name', 'Used By', 'Currency', 'Backed By'] },
		{ title: 'Commerce', icon: 'graph', fields: ['What Is Traded', 'Trade Routes'] },
		{ title: 'Pressure', icon: 'flame', fields: ['Taxes & Debt', 'Black Market'] },
	],
};

const RELIGION_SPEC: EntityKindSpec = {
	kind: 'religion',
	singular: 'Religion',
	plural: 'Religions & Beliefs',
	icon: 'sparkles',
	fallbackIcon: '🕯️',
	folderName: 'Religions',
	calloutType: 'quote',
	calloutTitle: 'Faith at a Glance',
	tagline: 'Gods, pantheons, cults, and holy rituals.',
	defaultName: 'Untitled Religion',
	defaultFields: [
		f('Name', 'text', 'What is this faith called?'),
		f('Deity or Focus', 'text', 'Who or what is worshipped?'),
		f('Followers', 'text', 'Who believes? Link with [[wikilinks]]'),
		f('Led By', 'text', 'Who speaks for it? Link with [[wikilinks]]'),
		f('Image', 'image', 'Vault path to a symbol, temple, or icon'),
		f('Core Beliefs', 'textarea', 'What do they hold to be true about the world?'),
		f('Rituals & Practice', 'textarea', 'What does worship actually look like, day to day?'),
		f('Holy Places & Texts', 'textarea', 'Where do they gather, and what do they read?'),
		f('Heresy & Enemies', 'textarea', 'What is forbidden, and who opposes them?'),
	],
	sections: [
		{ title: 'Essentials', icon: 'sparkles', fields: ['Name', 'Deity or Focus', 'Followers', 'Led By'] },
		{ title: 'Belief & Practice', icon: 'book-open', fields: ['Core Beliefs', 'Rituals & Practice'] },
		{ title: 'Power & Conflict', icon: 'flame', fields: ['Holy Places & Texts', 'Heresy & Enemies'] },
	],
};

const MAGIC_SPEC: EntityKindSpec = {
	kind: 'magic-system',
	singular: 'Magic System',
	plural: 'Magic Systems',
	icon: 'flame',
	fallbackIcon: '🔮',
	folderName: 'Magic Systems',
	calloutType: 'abstract',
	calloutTitle: 'Magic at a Glance',
	tagline: 'Spells, magical laws, costs, and limitations.',
	defaultName: 'Untitled Magic System',
	defaultFields: [
		f('Name', 'text', 'What is this magic called?'),
		f('Source', 'text', 'Where does the power come from?'),
		f('Who Can Use It', 'text', 'Born to it, trained into it, or bargained for?'),
		f('Cost', 'text', 'What does using it take from the user?'),
		f('Image', 'image', 'Vault path to a sigil, diagram, or image'),
		f('How It Works', 'textarea', 'The rules — what a user must do to make it happen'),
		f('Limits', 'textarea', 'What can it never do? This is what makes it interesting'),
		f('Consequences', 'textarea', 'What goes wrong when it is pushed too far?'),
		f('Who Controls It', 'textarea', 'Which schools, orders, or laws govern its use? Link with [[wikilinks]]'),
	],
	sections: [
		{ title: 'Essentials', icon: 'flame', fields: ['Name', 'Source', 'Who Can Use It', 'Cost'] },
		{ title: 'The Rules', icon: 'book-open', fields: ['How It Works', 'Limits'] },
		{ title: 'The Price', icon: 'warning', fields: ['Consequences', 'Who Controls It'] },
	],
	heroTitle: 'The Bargain',
	heroFields: [
		{ label: 'Source', icon: 'sparkles' },
		{ label: 'Cost', icon: 'flame' },
	],
};

const TECH_SPEC: EntityKindSpec = {
	kind: 'technology',
	singular: 'Technology',
	plural: 'Science & Technology',
	icon: 'gauge',
	fallbackIcon: '⚙️',
	folderName: 'Technology',
	calloutType: 'abstract',
	calloutTitle: 'Technology at a Glance',
	tagline: 'Tech levels, tools, medicine, and travel.',
	defaultName: 'Untitled Technology',
	defaultFields: [
		f('Name', 'text', 'What is this technology or field called?'),
		f('Era or Level', 'text', 'Bronze age, industrial, spacefaring, post-collapse…'),
		f('Who Has It', 'text', 'Who holds this knowledge? Link with [[wikilinks]]'),
		f('Availability', 'text', 'Everywhere, rare, restricted, forbidden?'),
		f('Image', 'image', 'Vault path to a diagram or device image'),
		f('How It Works', 'textarea', 'Enough of the principle that the reader believes it'),
		f('What It Changed', 'textarea', 'How did the world reorganise itself around this?'),
		f('Limits & Failures', 'textarea', 'What does it still not solve? How does it break?'),
		f('Who Is Left Behind', 'textarea', 'Who cannot access it, and what does that cost them?'),
	],
	sections: [
		{ title: 'Essentials', icon: 'gauge', fields: ['Name', 'Era or Level', 'Who Has It', 'Availability'] },
		{ title: 'The Technology', icon: 'note-pencil', fields: ['How It Works', 'What It Changed'] },
		{ title: 'Limits & Cost', icon: 'warning', fields: ['Limits & Failures', 'Who Is Left Behind'] },
	],
};

// ─── Culture & Lifestyle ─────────────────────────────────────────────────────

const CUSTOM_SPEC: EntityKindSpec = {
	kind: 'custom-tradition',
	singular: 'Custom',
	plural: 'Customs & Traditions',
	icon: 'heart',
	fallbackIcon: '🎎',
	folderName: 'Customs',
	calloutType: 'tip',
	calloutTitle: 'Custom at a Glance',
	tagline: 'Greetings, daily taboos, and holiday celebrations.',
	defaultName: 'Untitled Custom',
	defaultFields: [
		f('Name', 'text', 'What is this custom called?'),
		f('Type', 'text', 'Greeting, taboo, holiday, rite of passage, mourning…'),
		f('Practised By', 'text', 'Who observes it? Link with [[wikilinks]]'),
		f('When', 'text', 'Daily, seasonally, once in a lifetime?'),
		f('Image', 'image', 'Vault path to a representative image'),
		f('What Happens', 'textarea', 'Walk through it — what does an observer actually see?'),
		f('Origins', 'textarea', 'Where did it come from, and does anyone still remember why?'),
		f('Breaking It', 'textarea', 'What happens to someone who refuses or gets it wrong?'),
		f('Story Use', 'textarea', 'Which scene could turn on this custom?'),
	],
	sections: [
		{ title: 'Essentials', icon: 'heart', fields: ['Name', 'Type', 'Practised By', 'When'] },
		{ title: 'The Custom', icon: 'note-pencil', fields: ['What Happens', 'Origins'] },
		{ title: 'Consequence', icon: 'flame', fields: ['Breaking It', 'Story Use'] },
	],
};

const ARTS_SPEC: EntityKindSpec = {
	kind: 'arts',
	singular: 'Art Form',
	plural: 'Arts & Entertainment',
	icon: 'pen-nib',
	fallbackIcon: '🎭',
	folderName: 'Arts',
	calloutType: 'tip',
	calloutTitle: 'Art at a Glance',
	tagline: 'Fashion, architecture, food, and music.',
	defaultName: 'Untitled Art Form',
	defaultFields: [
		f('Name', 'text', 'What is it called?'),
		f('Type', 'text', 'Fashion, architecture, cuisine, music, theatre, sport…'),
		f('Associated With', 'text', 'Which people or place? Link with [[wikilinks]]'),
		f('Status', 'text', 'High art, common craft, banned, dying out?'),
		f('Image', 'image', 'Vault path to a representative image'),
		f('Description', 'textarea', 'What does it look, sound, or taste like?'),
		f('Who Makes It', 'textarea', 'The artists, guilds, or households behind it'),
		f('What It Says', 'textarea', 'What does taste in this reveal about a person?'),
		f('Notes', 'textarea', 'Anything else worth remembering'),
	],
	sections: [
		{ title: 'Essentials', icon: 'pen-nib', fields: ['Name', 'Type', 'Associated With', 'Status'] },
		{ title: 'The Work', icon: 'note-pencil', fields: ['Description', 'Who Makes It'] },
		{ title: 'Meaning', icon: 'sparkles', fields: ['What It Says', 'Notes'] },
	],
};

const LANGUAGE_SPEC: EntityKindSpec = {
	kind: 'language',
	singular: 'Language',
	plural: 'Languages & Dialects',
	icon: 'book-open',
	fallbackIcon: '🗣️',
	folderName: 'Languages',
	calloutType: 'abstract',
	calloutTitle: 'Language at a Glance',
	tagline: 'Alphabets, spoken tongues, and local slang.',
	defaultName: 'Untitled Language',
	defaultFields: [
		f('Name', 'text', 'What is this language called?'),
		f('Spoken By', 'text', 'Who speaks it? Link with [[wikilinks]]'),
		f('Script', 'text', 'What does its writing system look like — or is it unwritten?'),
		f('Status', 'text', 'Common, sacred, dying, forbidden, trade-tongue?'),
		f('Image', 'image', 'Vault path to a sample of the script'),
		f('Sound & Feel', 'textarea', 'What does it sound like to someone who does not speak it?'),
		f('Grammar Quirks', 'textarea', 'One or two rules that reveal how its speakers think'),
		f('Slang & Idioms', 'textarea', 'Phrases that only make sense to native speakers'),
		f('Who Cannot Speak It', 'textarea', 'Who is excluded by this language, and what does that cost?'),
	],
	sections: [
		{ title: 'Essentials', icon: 'book-open', fields: ['Name', 'Spoken By', 'Script', 'Status'] },
		{ title: 'The Language', icon: 'note-pencil', fields: ['Sound & Feel', 'Grammar Quirks'] },
		{ title: 'In Use', icon: 'users', fields: ['Slang & Idioms', 'Who Cannot Speak It'] },
	],
};

const LEXICON_SPEC: EntityKindSpec = {
	kind: 'lexicon',
	singular: 'Term',
	plural: 'Dictionary / Lexicon',
	icon: 'books',
	fallbackIcon: '📖',
	folderName: 'Lexicon',
	calloutType: 'note',
	calloutTitle: 'Term at a Glance',
	tagline: 'A quick-reference dictionary for custom words.',
	defaultName: 'Untitled Term',
	displayShape: 'row',
	defaultFields: [
		f('Term', 'text', 'The word as it is written'),
		f('Pronunciation', 'text', 'How is it said out loud?'),
		f('Language', 'text', 'Which tongue is it from? Link with [[wikilinks]]'),
		f('Part of Speech', 'text', 'Noun, verb, title, exclamation…'),
		f('Meaning', 'textarea', 'What does it mean, in plain English?'),
		f('Example Use', 'textarea', 'A sentence showing it in context'),
		f('Notes', 'textarea', 'Connotation, who uses it, when it would be rude…'),
	],
	sections: [
		{ title: 'The Word', icon: 'books', fields: ['Term', 'Pronunciation', 'Language', 'Part of Speech'] },
		{ title: 'Meaning', icon: 'note-pencil', fields: ['Meaning', 'Example Use', 'Notes'] },
	],
};

// ─── History & Lore ──────────────────────────────────────────────────────────

const WRITTEN_RECORDS_SPEC: EntityKindSpec = {
	kind: 'written-records',
	singular: 'Record',
	plural: 'Written Records & Documents',
	icon: 'book-bookmark',
	fallbackIcon: '📜',
	folderName: 'Records',
	calloutType: 'note',
	calloutTitle: 'Record at a Glance',
	tagline: 'In-world books, letters, laws, and diaries.',
	defaultName: 'Untitled Record',
	defaultFields: [
		f('Title', 'text', 'What is this document called?'),
		f('Type', 'text', 'Book, letter, law, diary, treaty, ledger…'),
		f('Author', 'text', 'Who wrote it? Link with [[wikilinks]]'),
		f('Date Written', 'text', 'When was it made?'),
		f('Where Kept', 'text', 'Who holds it now? Link with [[wikilinks]]'),
		f('Image', 'image', 'Vault path to an image of the document'),
		f('Contents', 'textarea', 'What does it actually say?'),
		f('Excerpt', 'textarea', 'A passage worth quoting directly in the story'),
		f('Why It Matters', 'textarea', 'What changes for whoever reads this?'),
	],
	sections: [
		{ title: 'Essentials', icon: 'book-bookmark', fields: ['Title', 'Type', 'Author', 'Date Written', 'Where Kept'] },
		{ title: 'The Document', icon: 'note-pencil', fields: ['Contents', 'Excerpt'] },
		{ title: 'Significance', icon: 'flame', fields: ['Why It Matters'] },
	],
};

const MYTH_SPEC: EntityKindSpec = {
	kind: 'myth',
	singular: 'Myth',
	plural: 'Myths & Legends',
	icon: 'book-open',
	fallbackIcon: '🐉',
	folderName: 'Myths',
	calloutType: 'quote',
	calloutTitle: 'Myth at a Glance',
	tagline: 'Folklore, rumors, and creation stories.',
	defaultName: 'Untitled Myth',
	defaultFields: [
		f('Name', 'text', 'What is this story called?'),
		f('Type', 'text', 'Creation myth, cautionary tale, rumour, ghost story…'),
		f('Told By', 'text', 'Who tells it? Link with [[wikilinks]]'),
		f('Believed?', 'text', 'Taken as fact, half-believed, or dismissed?'),
		f('Image', 'image', 'Vault path to a related image'),
		f('The Story', 'textarea', 'Tell it the way it would be told'),
		f('What Is True', 'textarea', 'The real events underneath — for your eyes only'),
		f('Why It Persists', 'textarea', 'What does believing this do for people?'),
		f('Story Use', 'textarea', 'How does this myth pay off in your plot?'),
	],
	sections: [
		{ title: 'Essentials', icon: 'book-open', fields: ['Name', 'Type', 'Told By', 'Believed?'] },
		{ title: 'The Tale', icon: 'note-pencil', fields: ['The Story', 'What Is True'] },
		{ title: 'Function', icon: 'flame', fields: ['Why It Persists', 'Story Use'] },
	],
};

const PROPHECY_SPEC: EntityKindSpec = {
	kind: 'prophecy',
	singular: 'Prophecy',
	plural: 'Prophecies',
	icon: 'eye',
	fallbackIcon: '🔮',
	folderName: 'Prophecies',
	calloutType: 'quote',
	calloutTitle: 'Prophecy at a Glance',
	tagline: 'Predictions, warnings, and omens.',
	defaultName: 'Untitled Prophecy',
	defaultFields: [
		f('Name', 'text', 'What is this prophecy called?'),
		f('Spoken By', 'text', 'Who made it? Link with [[wikilinks]]'),
		f('When Given', 'text', 'When was it spoken or found?'),
		f('Concerns', 'text', 'Who or what is it about? Link with [[wikilinks]]'),
		f('Image', 'image', 'Vault path to a related image or text'),
		f('The Words', 'textarea', 'The prophecy itself, exactly as it is repeated'),
		f('How It Is Read', 'textarea', 'What do people think it means?'),
		f('What It Actually Means', 'textarea', 'The true reading — for your eyes only'),
		f('Fulfilment', 'textarea', 'How and when does it come true, or fail to?'),
	],
	sections: [
		{ title: 'Essentials', icon: 'eye', fields: ['Name', 'Spoken By', 'When Given', 'Concerns'] },
		{ title: 'The Prophecy', icon: 'book-open', fields: ['The Words', 'How It Is Read'] },
		{ title: 'The Truth', icon: 'lock', fields: ['What It Actually Means', 'Fulfilment'] },
	],
};

/** Every kind introduced by the restructure, in no particular order. */
export const NEW_WORLDBUILDING_KINDS: EntityKindSpec[] = [
	REGION_SPEC, SETTLEMENT_SPEC, ZONE_SPEC, LANDMARK_SPEC,
	BLOODLINE_SPEC, GOVERNMENT_SPEC, MILITARY_SPEC, SOCIAL_CLASS_SPEC,
	SPACE_SPEC, TERRAIN_SPEC, WATER_SPEC, WEATHER_SPEC, CALENDAR_SPEC,
	SPECIES_SPEC, MONSTER_SPEC, WILDLIFE_SPEC, ILLNESS_SPEC,
	MONEY_SPEC, RELIGION_SPEC, MAGIC_SPEC, TECH_SPEC,
	CUSTOM_SPEC, ARTS_SPEC, LANGUAGE_SPEC, LEXICON_SPEC,
	WRITTEN_RECORDS_SPEC, MYTH_SPEC, PROPHECY_SPEC,
];

// ─── Codex sidebar groups ────────────────────────────────────────────────────

/** A top-level Codex heading with its ordered subcategories. */
export interface CodexGroupSpec {
	id: string;
	/** Heading shown in the sidebar */
	label: string;
	/** Hover / info text explaining what belongs in this group */
	info: string;
	/** Lucide/Phosphor icon name */
	icon: string;
	/** Text fallback if the icon fails to load */
	fallbackIcon: string;
	/** Subcategory kind ids, in display order */
	kinds: EntityKind[];
}

/**
 * The nine main Codex categories. This array is the single source of truth for
 * sidebar order — getCodexKindOrder() flattens it, so a kind that is not listed
 * here will not appear in the sidebar.
 */
export const CODEX_GROUPS: CodexGroupSpec[] = [
	{
		id: 'characters',
		label: 'Characters',
		info: 'People, creatures, or historical figures in your story.',
		icon: 'user',
		fallbackIcon: '👤',
		kinds: ['character'],
	},
	{
		id: 'places',
		label: 'Places & Locations',
		info: 'The physical layout of your world, from continents to buildings.',
		icon: 'map-pin',
		fallbackIcon: '📍',
		kinds: ['region', 'settlement', 'zone', 'landmark'],
	},
	{
		id: 'groups',
		label: 'Groups & Factions',
		info: 'How people organize themselves politically, socially, and by blood.',
		icon: 'users',
		fallbackIcon: '🏴',
		kinds: ['faction', 'bloodline', 'government', 'military', 'social-class'],
	},
	{
		id: 'nature',
		label: 'Nature & Universe',
		info: 'The physical laws, environments, and weather of your setting.',
		icon: 'planet',
		fallbackIcon: '🪐',
		kinds: ['space', 'terrain', 'water-body', 'weather', 'calendar'],
	},
	{
		id: 'creatures',
		label: 'Creatures & Life',
		info: 'All living things, from intelligent species to wild plants.',
		icon: 'ghost',
		fallbackIcon: '🐉',
		kinds: ['species', 'monster', 'wildlife', 'illness'],
	},
	{
		id: 'systems',
		label: 'Systems & Rules',
		info: 'The invisible laws of your society, economy, and magic that govern the world.',
		icon: 'gauge',
		fallbackIcon: '⚖️',
		kinds: ['money-trade', 'religion', 'magic-system', 'technology'],
	},
	{
		id: 'items',
		label: 'Items & Gear',
		info: 'Physical tools, weapons, and legendary relics.',
		icon: 'gem',
		fallbackIcon: '💎',
		kinds: ['item'],
	},
	{
		id: 'culture',
		label: 'Culture & Lifestyle',
		info: 'The customs, arts, and languages that give your world its texture.',
		icon: 'sparkles',
		fallbackIcon: '🎭',
		kinds: ['custom-tradition', 'arts', 'language', 'lexicon'],
	},
	{
		id: 'history',
		label: 'History & Lore',
		info: 'Historical events, written records, and folklore.',
		icon: 'books',
		fallbackIcon: '📜',
		kinds: ['event', 'written-records', 'myth', 'prophecy'],
	},
];
