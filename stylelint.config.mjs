// The Obsidian community directory's CSS checks, without stylelint-config-standard's
// formatting rules (the directory scan only reports the Obsidian-specific ones).
// Run: npm run lint:css
import obsidianmd from "stylelint-config-obsidianmd";

export default { plugins: obsidianmd.plugins, rules: obsidianmd.rules };
