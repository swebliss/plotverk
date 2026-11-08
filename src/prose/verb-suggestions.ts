// Pure curated adverb+verb → stronger-verb suggestion data — no Obsidian imports.
//
// Hand-curated, not sourced from an existing dataset: there is no usable
// open-source adverb→verb PAIR mapping at plugin size (WordNet and Moby are
// each many megabytes and map words to synonyms, not "walked quickly" to
// "sprinted"). AI-generated suggestions are planned as a separate, later Pro
// path — this static list is the mobile-first, zero-latency starting point.
// Source is kept well under 60KB.
//
// esbuild bundles this plugin as a single CJS file, so a dynamic import()
// here would be inlined rather than code-split — "lazy" below means the
// lookup Map is built on first call, not that the module loads late.

type SuggestionEntry = [adverb: string, verb: string, suggestions: string[]];

/** Builds [adverb, verb, suggestions] triples for one adverb from short [verb, suggestions] pairs. */
function g(adverb: string, pairs: Array<[string, string[]]>): SuggestionEntry[] {
	return pairs.map(([verb, suggestions]) => [adverb, verb, suggestions]);
}

const DATA: SuggestionEntry[] = [
	...g('quickly', [
		['walked', ['strode', 'hurried', 'marched']],
		['ran', ['sprinted', 'dashed', 'bolted']],
		['moved', ['darted', 'shot', 'flew']],
		['left', ['fled', 'bolted', 'dashed off']],
		['looked', ['glanced', 'flicked her eyes', 'shot a look']],
		['grabbed', ['snatched', 'seized', 'snapped up']],
		['ate', ['wolfed down', 'gobbled', 'devoured']],
		['wrote', ['dashed off', 'scrawled', 'scribbled']],
		['turned', ['spun', 'wheeled', 'whipped around']],
		['stood', ['shot up', 'sprang up', 'leapt up']],
		['*', ['hurried', 'raced', 'shot']],
	]),
	...g('slowly', [
		['walked', ['ambled', 'trudged', 'shuffled']],
		['moved', ['crept', 'inched', 'crawled']],
		['spoke', ['drawled', 'measured his words', 'drew out each word']],
		['turned', ['swiveled', 'eased around', 'turned by degrees']],
		['opened', ['eased open', 'cracked open', 'coaxed open']],
		['nodded', ['dipped his head', 'inclined his head']],
		['closed', ['eased shut', 'drew shut']],
		['breathed', ['exhaled slowly', 'let the breath ease out']],
		['*', ['lingered', 'eased', 'crept']],
	]),
	...g('quietly', [
		['said', ['murmured', 'whispered', 'breathed']],
		['spoke', ['murmured', 'whispered', 'muttered']],
		['closed', ['eased shut', 'clicked shut']],
		['walked', ['crept', 'padded', 'slipped']],
		['left', ['slipped away', 'vanished', 'melted into the crowd']],
		['laughed', ['chuckled softly', 'huffed a laugh']],
		['cried', ['wept silently', 'choked back tears']],
		['slipped', ['eased', 'crept', 'stole']],
		['*', ['murmured', 'whispered', 'hushed']],
	]),
	...g('loudly', [
		['said', ['bellowed', 'shouted', 'roared']],
		['spoke', ['boomed', 'thundered', 'blared']],
		['laughed', ['roared', 'howled', 'guffawed']],
		['knocked', ['hammered', 'pounded', 'banged']],
		['cried', ['wailed', 'howled', 'shrieked']],
		['sang', ['belted out', 'roared out']],
		['groaned', ['bellowed', 'howled']],
		['*', ['boomed', 'roared', 'thundered']],
	]),
	...g('softly', [
		['said', ['murmured', 'breathed', 'whispered']],
		['touched', ['brushed', 'grazed', 'skimmed']],
		['landed', ['settled', 'drifted down', 'alighted']],
		['smiled', ['half-smiled', 'softened']],
		['glowed', ['shimmered', 'gleamed faintly']],
		['hummed', ['murmured', 'purred']],
		['*', ['murmured', 'breathed', 'eased']],
	]),
	...g('angrily', [
		['said', ['snapped', 'barked', 'growled']],
		['spoke', ['snarled', 'spat', 'hissed']],
		['looked', ['glared', 'scowled', 'glowered']],
		['slammed', ['hurled', 'flung', 'smashed']],
		['shouted', ['roared', 'bellowed', 'thundered']],
		['glared', ['glowered', 'scowled']],
		['*', ['snapped', 'barked', 'growled']],
	]),
	...g('sadly', [
		['said', ['sighed', 'murmured']],
		['looked', ['mourned', 'gazed forlornly']],
		['smiled', ['managed a sad smile', 'smiled through tears']],
		['sighed', ['let out a heavy sigh']],
		['nodded', ['nodded heavily', 'bowed her head']],
		['*', ['sighed', 'lamented', 'grieved']],
	]),
	...g('happily', [
		['said', ['beamed', 'chirped']],
		['agreed', ['jumped at the chance', 'leapt at the offer']],
		['smiled', ['beamed', 'lit up']],
		['laughed', ['laughed brightly', 'bubbled with laughter']],
		['accepted', ['welcomed', 'embraced']],
		['*', ['beamed', 'grinned', 'brightened']],
	]),
	...g('nervously', [
		['said', ['stammered', 'stuttered']],
		['looked', ['glanced', 'darted her eyes']],
		['laughed', ['tittered', 'gave a shaky laugh']],
		['fidgeted', ['wrung her hands', 'picked at her sleeve']],
		['glanced', ['darted a look', 'flicked a glance']],
		['waited', ['fretted', 'paced']],
		['*', ['fidgeted', 'stammered', 'faltered']],
	]),
	...g('suddenly', [
		['stopped', ['froze', 'halted']],
		['appeared', ['materialized', 'burst in']],
		['realized', ['understood in a flash', 'saw it all at once']],
		['turned', ['spun around', 'whipped around']],
		['stood', ['shot to his feet', 'sprang up']],
		['remembered', ['recalled with a jolt']],
		['*', ['jolted', 'snapped', 'lurched']],
	]),
	...g('carefully', [
		['placed', ['eased', 'set down gently']],
		['read', ['studied', 'pored over']],
		['walked', ['picked her way', 'tiptoed']],
		['folded', ['smoothed', 'creased precisely']],
		['measured', ['weighed', 'gauged']],
		['considered', ['weighed', 'mulled over']],
		['*', ['eased', 'measured', 'weighed']],
	]),
	...g('gently', [
		['touched', ['brushed', 'grazed']],
		['placed', ['eased', 'lowered']],
		['pushed', ['nudged', 'coaxed']],
		['lowered', ['eased down', 'settled']],
		['stroked', ['caressed', 'traced']],
		['held', ['cradled', 'cupped']],
		['*', ['eased', 'coaxed', 'nudged']],
	]),
	...g('firmly', [
		['said', ['insisted', 'stated']],
		['held', ['gripped', 'clamped']],
		['gripped', ['clamped', 'clutched']],
		['stated', ['declared', 'asserted']],
		['pressed', ['pressed hard', 'bore down']],
		['*', ['insisted', 'gripped', 'held fast']],
	]),
	...g('sharply', [
		['said', ['snapped', 'retorted']],
		['turned', ['wheeled', 'spun']],
		['looked', ['glared', 'shot a look']],
		['inhaled', ['gasped', 'sucked in a breath']],
		['retorted', ['shot back', 'snapped back']],
		['*', ['snapped', 'retorted', 'cut in']],
	]),
	...g('weakly', [
		['said', ['murmured', 'croaked']],
		['smiled', ['managed a smile', 'gave a faint smile']],
		['nodded', ['gave a feeble nod']],
		['protested', ['managed a protest', 'mustered a protest']],
		['waved', ['gave a faint wave']],
		['*', ['faltered', 'wavered', 'sagged']],
	]),
	...g('tightly', [
		['held', ['clenched', 'gripped', 'clutched']],
		['closed', ['squeezed shut', 'screwed shut']],
		['gripped', ['clenched', 'clamped']],
		['clutched', ['clamped onto', 'gripped']],
		['wrapped', ['bound', 'cinched']],
		['*', ['clenched', 'gripped', 'clutched']],
	]),
	...g('easily', [
		['won', ['breezed through', 'cruised to victory']],
		['solved', ['cracked', 'unraveled']],
		['agreed', ['readily agreed', 'went along without hesitation']],
		['slipped', ['glided', 'slid']],
		['moved', ['glided', 'flowed']],
		['*', ['breezed through', 'sailed through']],
	]),
	...g('barely', [
		['survived', ['scraped by', 'clung to life']],
		['noticed', ['glimpsed', 'caught a hint of']],
		['managed', ['scraped together', 'just pulled off']],
		['escaped', ['narrowly escaped', 'slipped free']],
		['breathed', ['gasped a shallow breath']],
		['*', ['scraped by', 'managed']],
	]),
	...g('completely', [
		['destroyed', ['obliterated', 'demolished']],
		['forgot', ['blanked on', 'lost all memory of']],
		['changed', ['transformed', 'was unrecognizable']],
		['vanished', ['disappeared without a trace']],
		['ignored', ['dismissed outright', 'tuned out entirely']],
		['*', ['obliterated', 'erased', 'wiped out']],
	]),
	...g('immediately', [
		['left', ['bolted', 'fled']],
		['recognized', ['knew at once', 'placed instantly']],
		['responded', ['shot back', 'answered at once']],
		['turned', ['wheeled around at once']],
		['regretted', ['regretted instantly']],
		['*', ['bolted', 'snapped into action']],
	]),
	...g('finally', [
		['arrived', ['reached', 'made it at last']],
		['finished', ['wrapped up', 'closed out']],
		['spoke', ['broke the silence']],
		['agreed', ['relented', 'gave in']],
		['understood', ['it clicked', 'the truth landed']],
		['*', ['at last', 'reached']],
	]),
	...g('slightly', [
		['moved', ['shifted', 'edged']],
		['smiled', ["the corner of her mouth twitched"]],
		['shifted', ['edged', 'eased over']],
		['frowned', ['creased his brow']],
		['nodded', ['dipped her chin']],
		['*', ['edged', 'shifted']],
	]),
	...g('heavily', [
		['rained', ['poured', 'pelted down']],
		['breathed', ['gasped', 'panted']],
		['leaned', ['sagged against', 'slumped against']],
		['sighed', ['heaved a sigh']],
		['fell', ['collapsed', 'crashed down']],
		['*', ['bore down', 'pressed']],
	]),
	...g('lightly', [
		['touched', ['brushed', 'grazed']],
		['landed', ['alighted', 'settled']],
		['brushed', ['grazed', 'skimmed']],
		['kissed', ['brushed her lips against']],
		['tapped', ['rapped softly']],
		['*', ['brushed', 'grazed']],
	]),
	...g('briefly', [
		['paused', ['hesitated', 'faltered']],
		['looked', ['glanced', 'flicked a look']],
		['considered', ['weighed for a moment']],
		['smiled', ['flashed a smile']],
		['hesitated', ['faltered', 'wavered']],
		['*', ['glanced', 'flicked']],
	]),
	...g('deeply', [
		['sighed', ['a deep breath escaped her']],
		['loved', ['adored', 'cherished']],
		['breathed', ['drew a long breath']],
		['regretted', ['ached with regret']],
		['cared', ['cherished', 'held dear']],
		['*', ['cherished', 'treasured']],
	]),
	...g('warmly', [
		['smiled', ['beamed']],
		['greeted', ['welcomed']],
		['welcomed', ['embraced', 'ushered in warmly']],
		['embraced', ['enfolded', 'held close']],
		['thanked', ['thanked heartily']],
		['*', ['beamed', 'welcomed']],
	]),
	...g('coldly', [
		['said', ['intoned']],
		['looked', ['glared', 'fixed a cold stare']],
		['stared', ['fixed a hard stare']],
		['replied', ['replied flatly', 'retorted icily']],
		['dismissed', ['brushed off', 'waved away']],
		['*', ['iced over', 'froze him out']],
	]),
	...g('eagerly', [
		['agreed', ['jumped at']],
		['waited', ['itched']],
		['accepted', ['seized the offer']],
		['volunteered', ['leapt at the chance']],
		['nodded', ['nodded eagerly', 'bobbed his head']],
		['*', ['itched', 'jumped at the chance']],
	]),
	...g('anxiously', [
		['waited', ['fretted', 'paced']],
		['looked', ['scanned']],
		['watched', ['kept a wary eye on']],
		['paced', ['paced the floor']],
		['glanced', ['darted a worried look']],
		['*', ['fretted', 'paced']],
	]),
	...g('calmly', [
		['said', ['stated']],
		['walked', ['strolled']],
		['replied', ['answered evenly']],
		['explained', ['laid out plainly']],
		['waited', ['waited it out']],
		['*', ['settled', 'steadied himself']],
	]),
	...g('desperately', [
		['tried', ['scrambled', 'struggled']],
		['wanted', ['craved', 'ached for']],
		['fought', ['clawed', 'struggled']],
		['searched', ['scoured', 'tore through']],
		['pleaded', ['begged', 'implored']],
		['*', ['scrambled', 'clawed']],
	]),
	...g('fiercely', [
		['fought', ['battled', 'raged']],
		['loved', ['cherished fiercely', 'loved without restraint']],
		['argued', ['raged', 'clashed']],
		['defended', ['guarded fiercely', 'stood firm for']],
		['glared', ['glowered']],
		['*', ['raged', 'battled']],
	]),
	...g('gladly', [
		['agreed', ['jumped at']],
		['accepted', ['welcomed']],
		['helped', ['pitched in without hesitation']],
		['offered', ['freely offered']],
		['*', ['welcomed', 'embraced']],
	]),
	...g('gravely', [
		['said', ['intoned']],
		['nodded', ['bowed his head']],
		['warned', ['warned solemnly']],
		['considered', ['weighed soberly']],
		['*', ['intoned', 'solemnly stated']],
	]),
	...g('grimly', [
		['said', ['muttered']],
		['smiled', ['grimaced']],
		['nodded', ['set his jaw and nodded']],
		['pressed', ['pushed on', 'forged ahead']],
		['*', ['muttered', 'set his jaw']],
	]),
	...g('hastily', [
		['wrote', ['scrawled', 'scribbled']],
		['left', ['fled', 'bolted']],
		['packed', ['threw together', 'crammed']],
		['retreated', ['beat a retreat', 'bolted']],
		['added', ['tacked on hastily']],
		['*', ['scrambled', 'rushed']],
	]),
	...g('hoarsely', [
		['said', ['rasped', 'croaked']],
		['whispered', ['rasped']],
		['called', ['croaked out']],
		['laughed', ['gave a hoarse laugh']],
		['*', ['rasped', 'croaked']],
	]),
	...g('hungrily', [
		['ate', ['devoured', 'wolfed down']],
		['looked', ['eyed']],
		['devoured', ['wolfed down', 'gulped down']],
		['eyed', ['ogled hungrily']],
		['*', ['devoured', 'craved']],
	]),
	...g('lazily', [
		['moved', ['lounged', 'sprawled']],
		['smiled', ['smirked']],
		['stretched', ['lounged', 'sprawled out']],
		['waved', ['flicked a hand lazily']],
		['*', ['lounged', 'sprawled']],
	]),
	...g('painfully', [
		['moved', ['limped', 'winced']],
		['remembered', ['ached with the memory']],
		['limped', ['hobbled', 'dragged himself']],
		['winced', ['flinched', 'grimaced']],
		['*', ['winced', 'ached']],
	]),
	...g('silently', [
		['moved', ['slipped', 'crept']],
		['watched', ['observed', 'kept silent watch']],
		['agreed', ['nodded without a word']],
		['wept', ['cried without a sound']],
		['*', ['slipped', 'crept']],
	]),
	...g('smoothly', [
		['moved', ['glided', 'flowed']],
		['talked', ['charmed', 'smooth-talked']],
		['ran', ['hummed along', 'ran like clockwork']],
		['glided', ['flowed', 'drifted']],
		['*', ['glided', 'flowed']],
	]),
	...g('steadily', [
		['grew', ['climbed', 'mounted']],
		['moved', ['advanced']],
		['climbed', ['mounted', 'rose']],
		['increased', ['mounted', 'swelled']],
		['*', ['advanced', 'climbed']],
	]),
	...g('swiftly', [
		['moved', ['darted', 'shot']],
		['acted', ['struck']],
		['struck', ['lashed out', 'struck hard']],
		['turned', ['wheeled']],
		['*', ['darted', 'shot', 'struck']],
	]),
	...g('wearily', [
		['sighed', ['sagged']],
		['walked', ['trudged', 'dragged himself']],
		['nodded', ['nodded, too tired to argue']],
		['smiled', ['managed a tired smile']],
		['*', ['sagged', 'trudged']],
	]),
	...g('boldly', [
		['said', ['declared', 'proclaimed']],
		['stepped', ['strode forward', 'marched up']],
		['declared', ['proclaimed', 'announced']],
		['walked', ['strode', 'marched']],
		['announced', ['proclaimed', 'declared']],
		['*', ['declared', 'strode forward']],
	]),
	...g('timidly', [
		['said', ['murmured', 'ventured']],
		['knocked', ['tapped hesitantly']],
		['asked', ['ventured to ask']],
		['stepped', ['edged forward', 'crept forward']],
		['*', ['ventured', 'edged forward']],
	]),
	...g('roughly', [
		['pushed', ['shoved', 'shouldered']],
		['grabbed', ['seized', 'wrenched']],
		['handled', ['manhandled']],
		['shoved', ['shouldered', 'forced']],
		['*', ['shoved', 'wrenched']],
	]),
	...g('awkwardly', [
		['stood', ['shifted from foot to foot']],
		['laughed', ['gave a strained laugh']],
		['shuffled', ['fumbled', 'stumbled']],
		['smiled', ['gave a stiff smile']],
		['*', ['fumbled', 'stumbled']],
	]),
	...g('gracefully', [
		['moved', ['glided', 'flowed']],
		['danced', ['flowed', 'swept across the floor']],
		['turned', ['pivoted', 'swept around']],
		['landed', ['alighted']],
		['*', ['glided', 'flowed']],
	]),
];

let _index: Map<string, Map<string, string[]>> | null = null;

function buildIndex(): Map<string, Map<string, string[]>> {
	const index = new Map<string, Map<string, string[]>>();
	for (const [adverb, verb, suggestions] of DATA) {
		let byVerb = index.get(adverb);
		if (!byVerb) { byVerb = new Map(); index.set(adverb, byVerb); }
		byVerb.set(verb, suggestions);
	}
	return index;
}

/** Suggestions for a given adverb, optionally narrowed by the verb it modifies.
 *  Falls back to the adverb's '*' entry when the exact verb has no dedicated
 *  pairing, then to an empty array when the adverb itself is unknown. */
export function getVerbSuggestions(adverb: string, followingVerb?: string): string[] {
	if (!_index) _index = buildIndex();
	const byVerb = _index.get(adverb.toLowerCase());
	if (!byVerb) return [];
	const verb = followingVerb?.toLowerCase();
	if (verb && byVerb.has(verb)) return byVerb.get(verb) as string[];
	return byVerb.get('*') ?? [];
}

/**
 * The "Try" chips for an adverb, only when the word right next to it is a
 * verb we have a curated pairing for ("walked slowly" / "slowly walked").
 * No generic fallback: a chip must always read correctly when tapped, because
 * tapping replaces the verb AND the adverb with the one chosen word.
 * Multi-word suggestions are dropped — the coach hands out one word at most.
 */
export function findVerbPairing(
	adverb: string,
	prevWord?: string,
	nextWord?: string
): { side: 'prev' | 'next'; verb: string; suggestions: string[] } | null {
	if (!_index) _index = buildIndex();
	const byVerb = _index.get(adverb.toLowerCase());
	if (!byVerb) return null;
	for (const [side, w] of [['prev', prevWord], ['next', nextWord]] as const) {
		const verb = w?.toLowerCase();
		if (!verb || verb === '*' || !byVerb.has(verb)) continue;
		const suggestions = (byVerb.get(verb) as string[]).filter((s) => !/\s/.test(s));
		if (suggestions.length > 0) return { side, verb, suggestions };
	}
	return null;
}

/** Total curated (adverb, verb) pairs — exposed for tests, not used at runtime. */
export function suggestionDataSize(): number {
	return DATA.length;
}
