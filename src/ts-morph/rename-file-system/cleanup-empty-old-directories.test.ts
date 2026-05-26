import { describe, it, expect, vi } from "vitest";
import { createInMemoryProject } from "../_test-utils/create-in-memory-project";
import { cleanupEmptyOldDirectories } from "./cleanup-empty-old-directories";

vi.mock("../../utils/logger");

describe("cleanupEmptyOldDirectories", () => {
	it("空のディレクトリが残っている場合、削除する", () => {
		const project = createInMemoryProject();
		const fs = project.getFileSystem();
		const sf = project.createSourceFile("/src/old/a.ts", "export const a = 1;");
		project.saveSync();
		sf.deleteImmediatelySync();

		cleanupEmptyOldDirectories(project, [
			{ oldPath: "/src/old", newPath: "/src/new" },
		]);

		expect(fs.directoryExistsSync("/src/old")).toBe(false);
	});

	it("untracked ファイルが残っているディレクトリは削除しない", () => {
		const project = createInMemoryProject();
		const fs = project.getFileSystem();
		const sf = project.createSourceFile("/src/old/a.ts", "export const a = 1;");
		project.saveSync();
		sf.deleteImmediatelySync();
		fs.writeFileSync("/src/old/README.md", "stay");

		cleanupEmptyOldDirectories(project, [
			{ oldPath: "/src/old", newPath: "/src/new" },
		]);

		expect(fs.directoryExistsSync("/src/old")).toBe(true);
		expect(fs.readFileSync("/src/old/README.md")).toBe("stay");
	});

	it("directoryRenames が空の場合、何もしない", () => {
		const project = createInMemoryProject();
		expect(() => cleanupEmptyOldDirectories(project, [])).not.toThrow();
	});

	it("旧ディレクトリが既に存在しない場合、何もしない (forget のみ)", () => {
		const project = createInMemoryProject();
		// project tree に存在しないディレクトリ
		cleanupEmptyOldDirectories(project, [
			{ oldPath: "/src/nonexistent", newPath: "/src/new" },
		]);
		// throw しなければOK
	});

	it("AbortSignal で中断できる", () => {
		const project = createInMemoryProject();
		project.createSourceFile("/src/old/a.ts", "export const a = 1;");
		const controller = new AbortController();
		const abortReason = new Error("test-abort");
		controller.abort(abortReason);

		expect(() =>
			cleanupEmptyOldDirectories(
				project,
				[{ oldPath: "/src/old", newPath: "/src/new" }],
				controller.signal,
			),
		).toThrow(abortReason);
	});
});
