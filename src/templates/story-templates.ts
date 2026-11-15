import { StorygridTemplate } from '../grid-data';
import { t } from '../i18n';

// Beats down the side, story threads across the top — the same shape every
// template (and the Saltmarch sample) uses. Each template follows its source
// method's own beats; labels are English in every language for now (names
// and descriptions are translated).
//
// Each beat carries a `hint`: roughly where it falls in the book and what
// belongs there, written to teach a beginner the beat. applyTemplate turns it
// into a Beat guide card in a first guide column. Format: "~10% · text".
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
		// "Main Plot and Subplots beat guide" is too long for a 200px column: just "Beat guide".
		guideName: '',
		description: t('templates.defaultStorygrid.description'),
		rows: [
			beat('Setup', '0–10% · The main character’s normal life before anything goes wrong. Show who they are, who matters to them and what they stand to lose. End with a small hint that this calm can’t last.'),
			beat('Inciting Incident', '~10% · The event that knocks the main character’s life off course and starts the story’s main problem. After this, they can’t simply go back to how things were. Make it clear, so the reader knows what the story is about.'),
			beat('Rising Action', '10–50% · The main character tries to fix the problem, and each attempt makes things bigger or harder. New obstacles, people and choices appear. Keep raising the pressure, so every scene leaves them in a tighter spot than the last.'),
			beat('Midpoint', '~50% · A turn in the middle of the story that changes the goal or the rules. It might be a false win, a painful loss or a truth coming out. From here, the main character can no longer play it safe.'),
			beat('Climax', '75–90% · The final confrontation, where the main character faces the biggest obstacle head-on. Everything the story has set up, every promise and every hint, should pay off here. Win or lose, this is the moment the reader has been waiting for.'),
			beat('Falling Action', '90–98% · The dust settles after the climax. Show what the fight cost, who was hurt and what has changed for good. Tie up the loose ends of your subplots, so nothing important is left hanging.'),
			beat('Resolution', '98–100% · The new normal. Show the main character’s life after the story, and how they have changed since the Setup. A closing scene or image that echoes the opening helps the reader feel the whole journey.'),
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
			beat('The Ordinary World', '0–10% · The hero’s everyday life before the adventure. Show where they live, what they care about and the flaw or lack that holds them back. This is the world the journey will change, so the reader needs to know it well.'),
			beat('Call to Adventure', '~10% · Something arrives that invites the hero into an adventure: a problem, a message, a threat or a dare. It disturbs the Ordinary World and makes clear what the hero stands to gain or lose.'),
			beat('Refusal of the Call', '10–15% · The hero hesitates or says no, held back by fear, duty or doubt. Show what they would be giving up by leaving. This pause makes the risk feel real, and makes their choice to go mean more.'),
			beat('Meeting with the Mentor', '15–20% · The hero meets someone, or finds something, that helps them get ready. The mentor might give advice, training, courage or a useful gift. This help is what finally makes leaving possible.'),
			beat('Crossing the First Threshold', '~25% · The hero commits and crosses the threshold: the border between their familiar world and the unknown. There is no easy way back. This moment ends the first act and starts the real adventure.'),
			beat('Tests, Allies, Enemies', '25–40% · The hero learns the rules of the new world, often the hard way. Small challenges test their skills, and the people they meet turn out to be friends or foes. Each test prepares them for the bigger danger ahead.'),
			beat('Approach to the Inmost Cave', '40–50% · The hero gets close to the “inmost cave”: the most dangerous place or task in the story. They make a plan, and old doubts and fears come back. Build the tension, because the Ordeal, the story’s central crisis, is near.'),
			beat('The Ordeal', '~50% · The central crisis: the hero faces their greatest fear and comes close to death or total failure, either for real or in a symbolic way. Something important is lost. Surviving it changes the hero and turns the story.'),
			beat('The Reward', '50–65% · Having survived the Ordeal, the hero gains something: an object, new knowledge, a skill or love. There may be a moment to rest or celebrate. Let the reader enjoy it, but hint that the danger is not over.'),
			beat('The Road Back', '~75% · The consequences of the Ordeal catch up with the hero, and they must choose to finish what they started. The journey turns towards home, often with enemies in pursuit. The stakes rise again before the final test.'),
			beat('The Resurrection', '85–95% · The final and greatest test, bigger than the Ordeal. The hero has to use everything they have learned, and may go through a kind of death and rebirth. Winning here proves that their change is real.'),
			beat('Return with the Elixir', '95–100% · The hero comes home changed, carrying an “elixir”: something that heals or improves the Ordinary World, such as a treasure, a lesson or new wisdom. Show how home looks different now, and how the hero has grown.'),
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
		// The guide text is the owner's own, approved word for word (2026-11-15).
		id: 'save-the-cat',
		name: t('templates.saveTheCat.name'),
		guideName: t('templates.saveTheCat.guideName'),
		description: t('templates.saveTheCat.description'),
		rows: [
			beat('Opening Image', '0–1% · A snapshot of the main character’s life before the story changes it. Show who they are, where they are and what is wrong or missing, in one scene or image. The Final Image will mirror it, so the reader sees how far they have come.'),
			beat('Theme Stated', '~5% · A line from a supporting character that hints at the main character’s growth, especially the key truth they must learn by the end of the story. Also called the “life lesson.”'),
			beat('Setup', '1–10% · A view of the main character’s flawed daily life before the transformation. Introduce the supporting characters, their main goal, their resistance to change, and what they risk by refusing.'),
			beat('Catalyst', '~10% · A life-changing event that thrusts the main character into a new or unfamiliar world or mindset. It’s impossible to return to their old way of life.'),
			beat('Debate', '10–20% · A reaction phase where the main character weighs their next move, often framed as a central question like “Should I go?”, highlighting their hesitation to change.'),
			beat('Break Into 2', '~20% · The decisive turning point where the main character commits to the challenge, leaves their comfort zone, and enters a new world or mindset. It separates Act 1’s familiar routine from Act 2’s upside-down reality.'),
			beat('B Story', '~22% · The arrival of new “helper” characters, such as a mentor, love interest, rival, friend or family member, who will ultimately help the main character learn the story’s central lesson.'),
			beat('Fun and Games', '20–50% · A look at the main character navigating their new world, either thriving or struggling. Often called the “promise of the premise,” this section delivers the core hook that first drew readers to the story.'),
			beat('Midpoint', '~50% · The middle of the story, where the main character hits either a false victory (if they’ve been winning) or a false defeat (if they’ve been failing). A twist raises the stakes, pushing them toward real change.'),
			beat('Bad Guys Close In', '50–75% · Following a Midpoint false victory, things get steadily worse for the main character; following a false defeat, things seem to steadily improve instead. Either way, their deep-seated flaws (or internal enemies) are catching up with them.'),
			beat('All Is Lost', '~75% · The story’s lowest point, where a major setback collides with the main character’s internal flaws, driving them to rock bottom.'),
			beat('Dark Night of the Soul', '75–80% · A reflective pause where the main character processes everything so far, now worse off than at the start. It’s the darkest hour before dawn, moments away from finding the solution and grasping the life lesson.'),
			beat('Break Into 3', '~80% · The “aha!” moment when the main character realises what it takes to solve Act 2’s problems and, more importantly, to change themselves, bringing their character arc near completion.'),
			beat('Finale: Gathering the Team', '80–85% · The first step of the Finale. The main character puts the Break Into 3 plan together: they gather allies, make amends with people they hurt, and get the tools or skills they need. Show that they are no longer trying to do it alone.'),
			beat('Finale: Executing the Plan', '85–90% · The main character and their team carry out the plan, and at first it seems to work. Supporting characters may step up, take risks or make sacrifices. This shows how much the main character has grown and what the B Story gave them.'),
			beat('Finale: High Tower Surprise', '~90% · A twist the main character didn’t see coming: the plan fails, the villain is stronger than expected, or a hidden truth comes out. The old plan is gone, and the main character has to face the problem on their own.'),
			beat('Finale: Dig Deep Down', '90–95% · With no plan and no backup, the main character has to dig deep and find their courage. They finally trust the life lesson from Theme Stated and act on it. This is the moment that proves their change is real.'),
			beat('Finale: Execution of the New Plan', '95–99% · Acting on what they now believe, the main character finds a new way forward and wins in a way the person they were at the start never could. Enemies are defeated, flaws are overcome, and their world is left not only saved, but better than before.'),
			beat('Final Image', '99–100% · The opposite of the Opening Image. Show the main character’s life after the story, in one scene or image, so the reader sees how much they and their world have changed.'),
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
			beat('Act I: Setup', '0–10% · The opening of the story: the main character’s normal life and the flaw or problem they live with. Give the reader reasons to care about them before anything breaks. Plant the people, places and stakes that will matter later.'),
			beat('Act I: Inciting Incident', '~12% · The event that disrupts the main character’s normal life and starts the main problem of the story. They may not act on it straight away, but nothing can stay the same after this.'),
			beat('Act I: First Plot Point', '~25% · The main character commits to dealing with the problem, and the door to their old life closes behind them. This turning point ends Act I and launches them into the struggle of Act II.'),
			beat('Act II: Rising Action', '25–50% · The main character tries to solve the problem and runs into obstacles, failures and new complications. Each scene should raise the pressure a little more. This is where the reader learns what the main character is made of.'),
			beat('Act II: Midpoint', '~50% · A reversal in the middle of the story: a false win, a real loss or a discovery that changes the goal. The main character stops reacting and starts to take charge, and the stakes grow.'),
			beat('Act II: Complications', '50–75% · The opposition tightens its grip. Alliances shift, plans go wrong and every choice costs the main character more. Pressure builds from outside and from their own flaws, pushing them towards breaking point.'),
			beat('Act II: Second Plot Point', '~75% · The lowest point of the story, followed by the last piece of the puzzle: the main character learns or realises what they need to win. This turning point ends Act II and forces them to act.'),
			beat('Act III: Climax', '75–95% · The final confrontation between the main character and the opposition. They win or lose because of how they have changed, or failed to change, during the story. Every major thread should come to a head here.'),
			beat('Act III: Resolution', '95–100% · The aftermath of the climax. Tie up the remaining threads and show the main character’s new normal. Let the reader see what the story has changed, both in them and in their world.'),
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
		guideName: t('templates.romancingTheBeat.guideName'),
		description: t('templates.romancingTheBeat.description'),
		rows: [
			beat('Meet Cute', '0–10% · The two leads meet for the first time, a moment called the “meet cute”. There should be a spark between them, and some friction too. Show who each of them is, and give the reader a reason to want them together.'),
			beat('No Way (why it can’t work)', '~10% · The reason the two leads can’t be together, at least for now. It might be an old wound, a secret, a rival or a rule they won’t break. Make it strong enough that the reader truly wonders how they will overcome it.'),
			beat('Stuck Together', '15–25% · Circumstances force the two leads to share a space, a goal or a problem, so they can’t simply walk away from each other. Spending time together lets the attraction grow, whether they like it or not.'),
			beat('Falling', '25–40% · The two leads begin to fall for each other. Show small kindnesses, shared jokes and rare glimpses behind each other’s armour. Each starts to see who the other really is, and likes it more than they expected.'),
			beat('Midpoint of Love', '~50% · The two leads give in to their feelings: a first kiss, a night together or a confession. For a while it feels like this could really work. Let the reader enjoy it, because the old fears are about to return.'),
			beat('Doubt Creeps In', '50–60% · The old wound starts to stir again. Each lead notices what the other is hiding, or worries about being hurt. Small doubts and misunderstandings begin to put cracks in the relationship.'),
			beat('Shields Up', '60–70% · The two leads protect themselves instead of trusting each other. They pull back with distance, excuses or pride. Show that the fear behind the No Way beat is winning, even though the love is real.'),
			beat('Break-Up', '~75% · The thing they feared happens, and the relationship falls apart. One of the leads walks away, or both do. This should hurt, and it should grow out of their own wounds, not just bad luck.'),
			beat('Dark Night', '75–85% · Apart and alone, each lead faces their wound honestly for the first time. They realise what they have lost and what has been holding them back. This inner change makes a real happy ending possible.'),
			beat('Grand Gesture', '85–95% · One lead risks everything to prove they have changed, often in a big, public or costly way. The other answers by showing their own change. Together they overcome what has kept them apart since the No Way beat.'),
			beat('Happily Ever After', '95–100% · The promise of the romance is kept. Show the life the two leads have chosen together, and how each of them has grown. Leave the reader sure that this love will last.'),
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
			beat('The Lie They Believe', 'Before page one · The “lie”: a false belief the main character formed long before the story begins, often after a painful event. It shapes how they see the world and what they do. The whole story will test this belief until it breaks.'),
			beat('Life Under the Lie', '0–10% · The main character’s daily life, shaped by the false belief. For now it seems to work and keeps them safe, but it quietly costs them something important. Let the reader glimpse what they are missing.'),
			beat('Inciting Incident', '~10% · A problem arrives that the main character’s old belief can’t handle. It forces them to act and starts the main plot. From here, what happens on the outside will keep testing what they believe on the inside.'),
			beat('First Test of the Lie', '10–25% · The main character responds to the problem the old way, guided by the false belief. It half works, but the cost starts to show. Let the reader see what the false belief is costing them, even while it seems to help.'),
			beat('Doubling Down', '25–50% · Pressure rises, and instead of letting go of the false belief, the main character holds on to it even harder. Things get worse because of it, and small cracks start to appear in the belief.'),
			beat('Midpoint Shift', '~50% · The main character catches a glimpse of the truth behind the false belief, and can’t forget it. They may not change yet, but their certainty is shaken. From now on, the old way of thinking feels less safe.'),
			beat('Crisis of Belief', '~75% · The false belief fails completely, and the main character hits their lowest point. It is the worst moment of the story, and the most honest one. They can no longer pretend the old belief protects them.'),
			beat('The Choice', '75–95% · The main character acts on the new truth, even though it is risky and frightening. This is the climax on the inside and the outside at once: the decision they make shows who they have become.'),
			beat('The New Truth', '95–100% · Who the main character is now, living by the truth instead of the false belief. Let their actions prove the change, rather than a speech about it. Echo the opening, so the reader sees how far they have come.'),
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
		guideName: t('templates.horrorBeatsheet.guideName'),
		description: t('templates.horrorBeatsheet.description'),
		rows: [
			beat('Normal World', '0–10% · Ordinary people living ordinary lives, each with small cracks: a worry, a secret, a weakness. Introduce the main character and the place where the horror will happen. Plant its rules and details now, because they will matter later.'),
			beat('First Wrongness', '~10% · Something small is off: a sound, a shadow, an object out of place. The main character may barely notice it, but the reader should. This first hint starts the dread that the rest of the story will build on.'),
			beat('Explained Away', '10–20% · The main character finds an everyday reason for the strange signs, such as the wind, stress or a prank. The reader suspects otherwise. The gap between what the characters believe and what the reader fears creates tension.'),
			beat('Cut Off', '20–30% · The ways out start to close: the road floods, the phone dies, the help never comes. The main character is trapped with the threat, whether they know it yet or not. Being alone makes everything that follows more frightening.'),
			beat('Rising Dread', '30–50% · The signs multiply and grow harder to ignore. Nobody sleeps well, and tempers fray. The rules of the threat start to take shape, so the reader begins to understand what it can do and what might stop it.'),
			beat('First Blood', '~50% · The threat proves it is real, and someone pays the price: an injury, a death or a terrible loss. There is no more doubting or explaining away. The story shifts from fear of the unknown to a fight to survive.'),
			beat('The Truth Behind It', '50–70% · The main character learns what the threat is and why it is here, perhaps through research, a witness or digging into a buried past. But knowing the truth doesn’t help as much as they hoped, and the danger keeps growing.'),
			beat('Confrontation', '70–85% · The main character faces the threat on purpose, often with a plan built on what they have learned. It fails, or it works only at a terrible price. Their losses push them towards one final stand.'),
			beat('Final Battle', '85–95% · The last stand against the threat, usually on its own ground, where it is strongest. The main character must use everything they have learned and every rule set up earlier. Survival is never certain.'),
			beat('Aftermath / Final Scare', '95–100% · The survivors count what they have lost and how they have changed. Show their scars, inside and out. Then, if it suits your story, add one last sign that the horror isn’t really over.'),
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
		guideName: t('templates.sevenPointStoryStructure.guideName'),
		description: t('templates.sevenPointStoryStructure.description'),
		rows: [
			beat('Hook', '0–5% · The main character at the start, in a state that is the opposite of how they will end. If the story ends in strength, show weakness here. Planning this beat and the Resolution first makes the rest easier to build.'),
			beat('Plot Turn 1', '~25% · Something changes the main character’s world and pulls them into the central conflict. New people, ideas or problems set the story moving. This is where the real story gets going.'),
			beat('Pinch 1', '~37% · A pinch is a moment of pressure from the opposition. Here the villain or the main problem shows its strength, and something is lost or put at risk. It shows what the main character is up against and pushes them to respond.'),
			beat('Midpoint', '~50% · The main character stops simply reacting to events and starts to act. They decide to face the conflict directly, often because they understand it better now. From here, their choices drive the story.'),
			beat('Pinch 2', '~62% · The second pinch brings even more pressure. The plan falls apart, a helper such as a mentor may be lost, and all seems hopeless. The main character is left to face what comes next on their own.'),
			beat('Plot Turn 2', '~75% · The main character gets the final piece they need to succeed: a key fact, a skill, an ally or an inner change. They now have what it takes to win. Everything is in place for the ending.'),
			beat('Resolution', '90–100% · The climax and ending of the story, where the main character faces the conflict and wins or loses. It should be the opposite of the Hook, so the reader can see how much they have changed.'),
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
			beat('Act I: Exposition', '0–15% · Introduce the main character, the world they live in and what matters to them. Show the relationships and tensions that will drive the story. Plant the first seeds of the conflict, so the reader knows trouble is coming.'),
			beat('Act II: Rising Action', '15–45% · The conflict begins and grows. Complications stack up, choices get harder and the stakes rise with each scene. Everything here builds towards the turning point in Act III.'),
			beat('Act III: Climax', '45–60% · The turning point of the story, where the main character’s fortune changes direction, for better or worse. In this structure the climax sits in the middle, not at the end. After it, nothing can go back to how it was.'),
			beat('Act IV: Falling Action', '60–85% · The consequences of the turning point unfold. Events speed up and the main character struggles with what they have set in motion. Step by step, the ending begins to feel unavoidable.'),
			beat('Act V: Resolution', '85–100% · The final outcome. In a tragedy it is the main character’s downfall; in a happier story, their success. Show what the world is like now, and what the journey has cost or given them.'),
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

/**
 * The label for a new grid's guide column: named after its template
 * ("Save the Cat beat guide"), using the template's short guide name when it
 * has one. A template with no name, or an empty short name (the default
 * template, whose full name is too long for the column), gets the plain "Beat guide".
 * Custom (saved) templates get their own name the same way. The column is an
 * ordinary column afterwards: nothing looks it up by this label.
 */
export function guideColumnLabel(template: Pick<StorygridTemplate, 'name' | 'guideName'>): string {
	const name = (template.guideName ?? template.name ?? '').trim();
	return name ? t('grid.guide.headerNamed', { name }) : t('grid.guide.header');
}
