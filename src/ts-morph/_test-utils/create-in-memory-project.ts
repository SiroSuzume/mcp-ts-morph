import {
	IndentationText,
	type ManipulationSettings,
	Project,
	QuoteKind,
} from "ts-morph";

type Options = {
	pathAliases?: Record<string, string[]>;
	manipulationSettings?: Partial<ManipulationSettings>;
};

const DEFAULT_PATH_ALIASES: Record<string, string[]> = {
	"@/*": ["src/*"],
};

export function createInMemoryProject(options: Options = {}): Project {
	return new Project({
		useInMemoryFileSystem: true,
		compilerOptions: {
			baseUrl: ".",
			paths: options.pathAliases ?? DEFAULT_PATH_ALIASES,
			esModuleInterop: true,
			allowJs: true,
		},
		manipulationSettings: options.manipulationSettings,
	});
}

export function createInMemoryProjectWithDoubleQuotes(): Project {
	return createInMemoryProject({
		manipulationSettings: {
			indentationText: IndentationText.TwoSpaces,
			quoteKind: QuoteKind.Double,
		},
	});
}
