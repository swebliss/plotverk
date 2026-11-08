import { App } from 'obsidian';
import { entityFolderPath, CODEX_FOLDER } from '../entities/entity-manager';

/**
 * Create the standard project folder structure for a new story:
 * {projectName}/
 *   ├── {projectName}.storygrid   (the plot grid itself — lives in the root,
 *   │                              which is how every view finds the project)
 *   ├── Scenes/            (the manuscript)
 *   └── Codex/             (worldbuilding reference)
 *        ├── Characters/
 *        └── Places/
 *
 * No "Plot Grid" sub-folder: the grid file never went there, so it only ever
 * sat empty (Emma, 2026-11-03: "otherwise just remove the Plot Grid folder").
 */
export async function buildProjectStructure(
	app: App,
	rootPath: string,
	projectName: string
): Promise<{ charactersPath: string; scenesPath: string; locationsPath: string }> {
	const projectFolder = rootPath ? `${rootPath}/${projectName}` : projectName;

	const ensure = async (path: string) => {
		if (!app.vault.getAbstractFileByPath(path)) {
			await app.vault.createFolder(path);
		}
	};

	const scenesPath = entityFolderPath(projectFolder, 'scene');
	const charactersPath = entityFolderPath(projectFolder, 'character');
	const locationsPath = entityFolderPath(projectFolder, 'location');

	// Create the project root, then the manuscript folder, then the Codex
	// container before its sub-folders (createFolder needs the parent first).
	await ensure(projectFolder);
	await ensure(scenesPath);
	await ensure(`${projectFolder}/${CODEX_FOLDER}`);
	await ensure(charactersPath);
	await ensure(locationsPath);

	return { charactersPath, scenesPath, locationsPath };
}
