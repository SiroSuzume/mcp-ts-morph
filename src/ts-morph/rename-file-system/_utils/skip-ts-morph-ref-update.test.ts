import { describe, it, expect, vi } from "vitest";
import { createInMemoryProject } from "../../_test-utils/create-in-memory-project";
import { withSkippedTsMorphReferenceUpdates } from "./skip-ts-morph-ref-update";

vi.mock("../../../utils/logger");

describe("withSkippedTsMorphReferenceUpdates", () => {
	it("通常の Project では fn が実行され、prototype がパッチ後に復元される", () => {
		const project = createInMemoryProject();
		const sf = project.createSourceFile("/src/a.ts", "export const a = 1;");
		const proto = Object.getPrototypeOf(sf) as Record<string, unknown>;
		const originalGet = proto._getReferencesForMoveInternal;
		const originalUpdate = proto._updateReferencesForMoveInternal;

		const result = withSkippedTsMorphReferenceUpdates(project, () => {
			expect(proto._getReferencesForMoveInternal).not.toBe(originalGet);
			expect(proto._updateReferencesForMoveInternal).not.toBe(originalUpdate);
			return 42;
		});

		expect(result).toBe(42);
		expect(proto._getReferencesForMoveInternal).toBe(originalGet);
		expect(proto._updateReferencesForMoveInternal).toBe(originalUpdate);
	});

	it("fn が throw した場合でも prototype は復元される", () => {
		const project = createInMemoryProject();
		const sf = project.createSourceFile("/src/a.ts", "export const a = 1;");
		const proto = Object.getPrototypeOf(sf) as Record<string, unknown>;
		const originalGet = proto._getReferencesForMoveInternal;
		const originalUpdate = proto._updateReferencesForMoveInternal;

		expect(() =>
			withSkippedTsMorphReferenceUpdates(project, () => {
				throw new Error("boom");
			}),
		).toThrow("boom");

		expect(proto._getReferencesForMoveInternal).toBe(originalGet);
		expect(proto._updateReferencesForMoveInternal).toBe(originalUpdate);
	});

	it("Project に SourceFile が 1 つもない場合、fn はそのまま実行される (fallback)", () => {
		const project = createInMemoryProject();
		const result = withSkippedTsMorphReferenceUpdates(project, () => "ok");
		expect(result).toBe("ok");
	});

	it("prototype の私的 API が見つからない場合も fn はそのまま実行される (fallback)", () => {
		const project = createInMemoryProject();
		const sf = project.createSourceFile("/src/a.ts", "export const a = 1;");
		const proto = Object.getPrototypeOf(sf) as Record<string, unknown>;
		const originalGet = proto._getReferencesForMoveInternal;
		const originalUpdate = proto._updateReferencesForMoveInternal;

		// private API を一時的に非関数に差し替える
		proto._getReferencesForMoveInternal = undefined;
		proto._updateReferencesForMoveInternal = undefined;

		try {
			const result = withSkippedTsMorphReferenceUpdates(project, () => "ok");
			expect(result).toBe("ok");
		} finally {
			proto._getReferencesForMoveInternal = originalGet;
			proto._updateReferencesForMoveInternal = originalUpdate;
		}
	});
});
