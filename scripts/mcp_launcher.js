const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

// --- 設定 ---
// ログファイルの出力先 (適宜変更してください)
const LOG_FILE_PATH = path.resolve(__dirname, "../.logs/mcp_launcher.log");
// 実際に実行するコマンドと引数
const ACTUAL_COMMAND = "npx";
const ACTUAL_ARGS = ["-y", "@sirosuzume/mcp-tsmorph-refactor"];
// --- 設定ここまで ---

function ensureLogDirectoryExists(filePath) {
	const dirname = path.dirname(filePath);
	if (fs.existsSync(dirname)) {
		return true;
	}
	fs.mkdirSync(dirname, { recursive: true });
}

function logToFile(message) {
	try {
		ensureLogDirectoryExists(LOG_FILE_PATH);
		const timestamp = new Date().toISOString();
		fs.appendFileSync(LOG_FILE_PATH, `[${timestamp}] ${message}\n`);
	} catch (error) {
		// ログファイルへの書き込み失敗はコンソールに出力 (ただしMCPクライアントからは見えない可能性)
		console.error("Failed to write to launcher log file:", error);
	}
}

logToFile("Launcher script started.");
logToFile(`CWD: ${process.cwd()}`);
logToFile(`Executing: ${ACTUAL_COMMAND} ${ACTUAL_ARGS.join(" ")}`);

const child = spawn(ACTUAL_COMMAND, ACTUAL_ARGS, {
	stdio: ["pipe", "pipe", "pipe"], // stdin, stdout, stderr をパイプ
	shell: process.platform === "win32", // Windowsではshell: trueが安定することがある
});

logToFile(`Spawned child process with PID: ${child.pid}`);

// 子プロセスの標準出力をラッパーの標準出力とログファイルに流す
child.stdout.on("data", (data) => {
	process.stdout.write(data); // MCPクライアントへの出力
	logToFile(`[CHILD STDOUT] ${data.toString().trim()}`);
});

// 子プロセスの標準エラー出力をラッパーの標準エラー出力とログファイルに流す
child.stderr.on("data", (data) => {
	process.stderr.write(data); // MCPクライアントへの出力 (エラーとして)
	logToFile(`[CHILD STDERR] ${data.toString().trim()}`);
});

// 親プロセスの標準入力を子プロセスに流す
process.stdin.pipe(child.stdin);

child.on("error", (error) => {
	logToFile(`Failed to start child process: ${error.message}`);
	process.exit(1); // エラーで終了
});

child.on("close", (code, signal) => {
	logToFile(`Child process closed with code ${code}, signal ${signal}`);
});

child.on("exit", (code, signal) => {
	logToFile(`Child process exited with code ${code}, signal ${signal}`);
	process.exitCode = code ?? 1; // 親プロセスの終了コードを設定
});

process.on("exit", (code) => {
	logToFile(`Launcher script exiting with code ${code}.`);
});
