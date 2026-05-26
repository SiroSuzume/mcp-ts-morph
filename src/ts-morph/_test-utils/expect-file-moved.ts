import type { Project } from "ts-morph";
import { expect } from "vitest";

export function expectFileMoved(
	project: Project,
	from: string,
	to: string,
): void {
	expect(
		project.getSourceFile(from),
		`expected '${from}' to be removed`,
	).toBeUndefined();
	expect(project.getSourceFile(to), `expected '${to}' to exist`).toBeDefined();
}
