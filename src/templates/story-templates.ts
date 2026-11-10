import { StorygridTemplate } from '../grid-data';
import { t } from '../i18n';

// Beats down the side, story threads across the top — the same shape every
// template (and the Saltmarch sample) uses. Each template follows its source
// method's own beats; labels are English in every language for now (names
// and descriptions are translated).
//
// Each beat carries a `hint`: roughly where it falls in the book and what
// belongs there. It shows faintly in the first column of a new grid until a
// card is placed in that cell. Format: "~10% · text".
const beat = (label: string, hint?: string) => ({ label, color: undefined, hint });

export const STORY_TEMPLATES: StorygridTemplate[] = [
	{
		id: 'clean-start',
		name: t('templates.cleanStart.name'),
		description: t('templates.cleanStart.description'),
		rows: [{ label: 'Beat 1', color: undefined }],
		columns: [{ label: 'Thread 1', color: undefined }],
	},

	{
		id: 'default-storygrid',
		name: t('templates.defaultStorygrid.name'),
		description: t('templates.defaultStorygrid.description'),
		rows: [
			beat('Setup', '0–10% · Normal life, the people who matter, what’s at stake. End it with a hint that it can’t last.'),
			beat('Inciting Incident', '~10% · The event that knocks life off course. Your lead can’t go back after this.'),
			beat('Rising Action', '10–50% · Each attempt to fix things makes them bigger. Stakes and pressure climb.'),
			beat('Midpoint', '~50% · A turn that changes the goal or the rules: a false win, a real loss, or the truth comes out.'),
			beat('Climax', '75–90% · The final confrontation. Everything the story set up gets paid.'),
			beat('Falling Action', '90–98% · The dust settles. Show what the climax cost and changed.'),
			beat('Resolution', '98–100% · The new normal. One last image that answers the opening.'),
		],
		columns: [
			{ label: 'Main Plot', color: undefined },
			{ label: 'Subplot A', color: undefined },
			{ label: 'Subplot B', color: undefined },
			{ label: 'Subplot C', color: undefined },
		],
	},

	{
		id: 'heros-journey',
		name: t('templates.herosJourney.name'),
		description: t('templates.herosJourney.description'),
		rows: [
			beat('The Ordinary World', '0–10% · The hero at home, with the flaw and the lack the journey will fix.'),
			beat('Call to Adventure', '~10% · A problem, a message or a dare that offers the journey.'),
			beat('Refusal of the Call', '10–15% · Fear or duty says no. Show what the hero stands to lose.'),
			beat('Meeting with the Mentor', '15–20% · Advice, training or a gift that makes leaving possible.'),
			beat('Crossing the First Threshold', '~25% · The hero commits and enters the unknown. Act One ends here.'),
			beat('Tests, Allies, Enemies', '25–40% · The new world’s rules, learned the hard way. Friends and foes sort themselves out.'),
			beat('Approach to the Inmost Cave', '40–50% · Preparation and a plan for the big danger. Doubts surface.'),
			beat('The Ordeal', '~50% · The central crisis: a brush with death, real or symbolic. Something is lost.'),
			beat('The Reward', '50–65% · What surviving earned: an object, knowledge, love. A breath before the fall.'),
			beat('The Road Back', '~75% · Consequences chase the hero home. A choice to finish what was started.'),
			beat('The Resurrection', '85–95% · The final test, bigger than the Ordeal. The hero proves the change is real.'),
			beat('Return with the Elixir', '95–100% · Home, changed, with something that heals the Ordinary World.'),
		],
		columns: [
			{ label: 'Hero', color: undefined },
			{ label: 'Mentor', color: undefined },
			{ label: 'Shadow (antagonist)', color: undefined },
			{ label: 'Allies', color: undefined },
		],
	},

	{
		// Jessica Brody's "Save the Cat! Writes a Novel": Snyder's fifteen beats
		// in her wording, with her five-step Finale as five rows so every beat has a row.
		id: 'save-the-cat',
		name: t('templates.saveTheCat.name'),
		description: t('templates.saveTheCat.description'),
		rows: [
			beat('Opening Image', '0–1% · One snapshot of the hero before the change. Mirror it at the end.'),
			beat('Theme Stated', '~5% · Someone says, in passing, what the hero needs to learn.'),
			beat('Setup', '1–10% · The hero’s flawed status quo: home, work, play, and what’s missing.'),
			beat('Catalyst', '~10% · The life-changing event. No going back.'),
			beat('Debate', '10–20% · Should I? Can I? The hero hesitates, weighs, prepares.'),
			beat('Break Into 2', '~20% · The hero chooses, and steps into the new world of Act 2.'),
			beat('B Story', '~22% · A new character or relationship enters, carrying the theme.'),
			beat('Fun and Games', '20–50% · The promise of the premise. Why the reader bought the book.'),
			beat('Midpoint', '~50% · False victory or false defeat. Stakes rise; the A and B stories cross.'),
			beat('Bad Guys Close In', '50–75% · Outside forces push and inner flaws fester. It gets worse.'),
			beat('All Is Lost', '~75% · The lowest point. A whiff of death: something or someone is gone.'),
			beat('Dark Night of the Soul', '75–80% · The hero sits in the loss, and finally learns the theme.'),
			beat('Break Into 3', '~80% · The hero sees the solution. The B Story shows the way.'),
			beat('Finale: Gathering the Team', '80–85% · Make amends, gather allies, prepare.'),
			beat('Finale: Executing the Plan', '85–90% · The plan is set in motion.'),
			beat('Finale: High Tower Surprise', '~90% · A twist: the plan fails, or the villain reveals more.'),
			beat('Finale: Dig Deep Down', '90–95% · The hero finds the new strength the theme taught.'),
			beat('Finale: Execution of the New Plan', '95–99% · The new plan works. The hero wins by having changed.'),
			beat('Final Image', '99–100% · The opening snapshot again, now transformed.'),
		],
		columns: [
			{ label: 'Hero', color: undefined },
			{ label: 'B Story Character', color: undefined },
			{ label: 'Antagonist', color: undefined },
		],
	},

	{
		id: 'three-act-structure',
		name: t('templates.threeActStructure.name'),
		description: t('templates.threeActStructure.description'),
		rows: [
			beat('Act I: Setup', '0–10% · Normal life and the flaw. Make us care before you break it.'),
			beat('Act I: Inciting Incident', '~12% · The event that disrupts everything.'),
			beat('Act I: First Plot Point', '~25% · The hero commits to the problem. The door closes behind them.'),
			beat('Act II: Rising Action', '25–50% · Attempts, failures and new complications.'),
			beat('Act II: Midpoint', '~50% · A reversal: a false win, a true loss, or a revelation that changes the goal.'),
			beat('Act II: Complications', '50–75% · The opposition tightens. Alliances shift. The cost grows.'),
			beat('Act II: Second Plot Point', '~75% · The low point and the last piece of the puzzle. The hero must act.'),
			beat('Act III: Climax', '75–95% · The final confrontation, won or lost by the change the hero made.'),
			beat('Act III: Resolution', '95–100% · Aftermath, and the new normal.'),
		],
		columns: [
			{ label: 'Protagonist', color: undefined },
			{ label: 'Antagonist', color: undefined },
			{ label: 'Supporting Cast', color: undefined },
		],
	},

	{
		// Gwen Hayes' "Romancing the Beat", in plain words.
		id: 'romancing-the-beat',
		name: t('templates.romancingTheBeat.name'),
		description: t('templates.romancingTheBeat.description'),
		rows: [
			beat('Meet Cute', '0–10% · The leads collide. Spark and friction in the same scene.'),
			beat('No Way (why it can’t work)', '~10% · The reason it can’t work: a wound, a secret, a rival, a rule.'),
			beat('Stuck Together', '15–25% · Circumstance forces them to share a space or a goal.'),
			beat('Falling', '25–40% · Small kindnesses and glimpses behind the armour.'),
			beat('Midpoint of Love', '~50% · They give in: the kiss, the night, the confession. It feels like it could work.'),
			beat('Doubt Creeps In', '50–60% · The old wound stirs. Each notices what the other hides.'),
			beat('Shields Up', '60–70% · They protect themselves. Distance, excuses, pride.'),
			beat('Break-Up', '~75% · The thing they feared happens. One of them walks away.'),
			beat('Dark Night', '75–85% · Alone, each faces the wound honestly for the first time.'),
			beat('Grand Gesture', '85–95% · One risks everything to prove the change. The other answers.'),
			beat('Happily Ever After', '95–100% · The promise kept. Show the life they chose.'),
		],
		columns: [
			{ label: 'Lead 1', color: undefined },
			{ label: 'Lead 2', color: undefined },
			{ label: 'The Relationship', color: undefined },
		],
	},

	{
		// Lisa Cron's "Story Genius": the misbelief, tested until it breaks.
		id: 'story-genius',
		name: t('templates.storyGenius.name'),
		description: t('templates.storyGenius.description'),
		rows: [
			beat('The Lie They Believe', 'Before page one · The misbelief your lead formed long ago and still lives by.'),
			beat('Life Under the Lie', '0–10% · Daily life shaped by the lie. It seems to work. It costs them something.'),
			beat('Inciting Incident', '~10% · A problem the lie can’t handle. It forces them to act.'),
			beat('First Test of the Lie', '10–25% · They respond the old way. It half works, and the cost shows.'),
			beat('Doubling Down', '25–50% · Pressure rises and they cling harder. The lie starts to crack.'),
			beat('Midpoint Shift', '~50% · They see a glimpse of the truth, and can’t unsee it.'),
			beat('Crisis of Belief', '~75% · The lie fails completely. The worst moment, and the honest one.'),
			beat('The Choice', '75–95% · Acting on the new truth, at real risk. The climax, inside and out.'),
			beat('The New Truth', '95–100% · Who they are now. Show it in action, not in a speech.'),
		],
		columns: [
			{ label: 'What Happens', color: undefined },
			{ label: 'What It Does to Them', color: undefined },
			{ label: 'What They Want vs Need', color: undefined },
		],
	},

	{
		id: 'horror-beatsheet',
		name: t('templates.horrorBeatsheet.name'),
		description: t('templates.horrorBeatsheet.description'),
		rows: [
			beat('Normal World', '0–10% · Ordinary people with ordinary cracks. Plant the place and its rules.'),
			beat('First Wrongness', '~10% · Something small is off. Easy to miss. The reader doesn’t.'),
			beat('Explained Away', '10–20% · They rationalise it: wind, stress, a prank. The reader knows better.'),
			beat('Cut Off', '20–30% · Escape closes: the road, the phone, the help that isn’t coming.'),
			beat('Rising Dread', '30–50% · Signs multiply. Nobody sleeps. The rules of the threat take shape.'),
			beat('First Blood', '~50% · The threat proves real and someone pays. No more doubting.'),
			beat('The Truth Behind It', '50–70% · What it is and why. Knowing doesn’t help as much as hoped.'),
			beat('Confrontation', '70–85% · They face it on purpose, and fail, or win at a terrible price.'),
			beat('Final Battle', '85–95% · The last stand, on the threat’s own ground.'),
			beat('Aftermath / Final Scare', '95–100% · Survivors, scars, and one last sign that it isn’t over.'),
		],
		columns: [
			{ label: 'Protagonist', color: undefined },
			{ label: 'The Threat', color: undefined },
			{ label: 'Setting', color: undefined },
		],
	},

	{
		id: 'seven-point-story-structure',
		name: t('templates.sevenPointStoryStructure.name'),
		description: t('templates.sevenPointStoryStructure.description'),
		rows: [
			beat('Hook', '0–5% · The hero at their worst: the opposite of where they end.'),
			beat('Plot Turn 1', '~25% · The world changes; the hero is pulled into the conflict.'),
			beat('Pinch 1', '~37% · Pressure: the villain shows their strength, something is lost.'),
			beat('Midpoint', '~50% · The hero stops reacting and starts acting.'),
			beat('Pinch 2', '~62% · The plan falls apart. The mentor is gone. All seems lost.'),
			beat('Plot Turn 2', '~75% · The final piece of information: the hero has what they need.'),
			beat('Resolution', '90–100% · The ending the Hook was built to contrast.'),
		],
		columns: [
			{ label: 'Main Plot', color: undefined },
			{ label: 'Character Arc', color: undefined },
			{ label: 'Subplot', color: undefined },
		],
	},

	{
		id: 'five-act-structure',
		name: t('templates.fiveActStructure.name'),
		description: t('templates.fiveActStructure.description'),
		rows: [
			beat('Act I: Exposition', '0–15% · Who, where, what matters. The seeds of the conflict.'),
			beat('Act II: Rising Action', '15–45% · Complications stack up toward the turning point.'),
			beat('Act III: Climax', '45–60% · The turning point: the moment fortune changes direction.'),
			beat('Act IV: Falling Action', '60–85% · Consequences unwind; the end becomes inevitable.'),
			beat('Act V: Resolution', '85–100% · The outcome, and what the world is like now.'),
		],
		columns: [
			{ label: 'Main Thread', color: undefined },
			{ label: 'Subplot', color: undefined },
		],
	},
];

/**
 * Find a template by ID.
 */
export function getTemplateById(templateId: string): StorygridTemplate | undefined {
	return STORY_TEMPLATES.find((t) => t.id === templateId);
}

/**
 * Get all available templates.
 */
export function getAllTemplates(): StorygridTemplate[] {
	return STORY_TEMPLATES;
}
