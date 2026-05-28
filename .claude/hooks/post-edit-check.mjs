#!/usr/bin/env node
// PostToolUse hook: src 配下の .ts を編集したら関連テスト + 型チェックを走らせる。
// 失敗時は exit 2 で stderr を Claude に返し、修正を促す。
// 入力: stdin に Claude Code の PostToolUse JSON（tool_name / tool_input.file_path 等）。

import { execFileSync } from "node:child_process";
import { relative, isAbsolute } from "node:path";

function readStdin() {
	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => resolve(data));
	});
}

const raw = await readStdin();
let payload;
try {
	payload = JSON.parse(raw);
} catch {
	// JSON でなければ何もしない
	process.exit(0);
}

const filePath = payload?.tool_input?.file_path;
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

if (!filePath) process.exit(0);

const rel = isAbsolute(filePath) ? relative(projectDir, filePath) : filePath;

// src 配下の .ts/.tsx のみ対象（.d.ts と dist/coverage/node_modules は除外）
const isTarget =
	rel.startsWith("src/") && /\.(ts|tsx)$/.test(rel) && !rel.endsWith(".d.ts");

if (!isTarget) process.exit(0);

const failures = [];

function run(label, file, args) {
	try {
		execFileSync(file, args, {
			cwd: projectDir,
			stdio: ["ignore", "pipe", "pipe"],
			encoding: "utf8",
		});
	} catch (err) {
		const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
		failures.push(`### ${label} 失敗\n${out}`);
	}
}

const vitestArgs = [
	"exec",
	"vitest",
	rel.includes(".test.") ? "run" : "related",
	rel,
	"--run",
	"--pool",
	"threads",
	"--poolOptions.threads.singleThread",
];

run("関連テスト", "pnpm", vitestArgs);
run("型チェック (check-types)", "pnpm", ["run", "check-types"]);

if (failures.length > 0) {
	process.stderr.write(
		`編集後チェックで問題を検出しました (${rel}):\n\n${failures.join("\n\n")}\n`,
	);
	process.exit(2);
}

process.exit(0);
