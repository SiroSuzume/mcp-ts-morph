import type { Project } from "ts-morph";

export function getFileText(project: Project, path: string): string {
	const sourceFile = project.getSourceFile(path);
	if (!sourceFile) {
		throw new Error(`Test setup failed: source file '${path}' not found`);
	}
	return sourceFile.getFullText();
}
