import { Project, type SourceFile } from "ts-morph";
import * as path from "node:path";
import { NewLineKind } from "typescript";
import logger from "../../utils/logger";

export function initializeProject(tsconfigPath: string): Project {
	const absoluteTsconfigPath = path.resolve(tsconfigPath);
	return new Project({
		tsConfigFilePath: absoluteTsconfigPath,
		manipulationSettings: {
			newLineKind: NewLineKind.LineFeed,
		},
	});
}

export function getChangedFiles(project: Project): SourceFile[] {
	return project.getSourceFiles().filter((sf) => !sf.isSaved());
}

export async function saveProjectChanges(
	project: Project,
	signal?: AbortSignal,
): Promise<void> {
	signal?.throwIfAborted();
	try {
		await project.save();
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw error;
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`ファイル保存中にエラーが発生しました: ${message}`);
	}
}

export function getTsConfigPaths(
	project: Project,
): Record<string, string[]> | undefined {
	try {
		const options = project.compilerOptions.get();
		if (!options.paths) {
			return undefined;
		}
		if (typeof options.paths !== "object") {
			logger.warn(
				{ paths: options.paths },
				"Compiler options 'paths' is not an object.",
			);
			return undefined;
		}

		const validPaths: Record<string, string[]> = {};
		for (const [key, value] of Object.entries(options.paths)) {
			if (
				Array.isArray(value) &&
				value.every((item) => typeof item === "string")
			) {
				validPaths[key] = value;
			} else {
				logger.warn(
					{ pathKey: key, pathValue: value },
					"Invalid format for paths entry, skipping.",
				);
			}
		}
		return validPaths;
	} catch (error) {
		logger.error({ err: error }, "Failed to get compiler options or paths");
		return undefined;
	}
}

export function getTsConfigBaseUrl(project: Project): string | undefined {
	try {
		const options = project.compilerOptions.get();
		return options.baseUrl;
	} catch (error) {
		logger.error({ err: error }, "Failed to get compiler options baseUrl");
		return undefined;
	}
}
