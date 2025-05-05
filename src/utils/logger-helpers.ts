import * as fs from "node:fs";
import * as path from "node:path";
import type pino from "pino";
import { z } from "zod";

const DEFAULT_NODE_ENV = "development";
const DEFAULT_LOG_LEVEL: pino.Level = "info";
const DEFAULT_LOG_OUTPUT: "console" | "file" = "console";
const DEFAULT_LOG_FILE_PATH = path.resolve(process.cwd(), "app.log");

const envSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default(DEFAULT_NODE_ENV),
	LOG_LEVEL: z
		.enum(["fatal", "error", "warn", "info", "debug", "trace"])
		.default(DEFAULT_LOG_LEVEL),
	LOG_OUTPUT: z.enum(["console", "file"]).default(DEFAULT_LOG_OUTPUT),
	LOG_FILE_PATH: z.string().default(DEFAULT_LOG_FILE_PATH),
});

type EnvConfig = z.infer<typeof envSchema>;

/**
 * 環境変数を Zod スキーマでパースし、検証済みの設定オブジェクトを返します。
 * パースに失敗した場合は、エラーメッセージをコンソールに出力し、
 * デフォルト値を持つ設定オブジェクトを返します。
 *
 * @returns {EnvConfig} 検証済みまたはデフォルトの環境変数設定。
 */
export function parseEnvVariables(): EnvConfig {
	const parseResult = envSchema.safeParse(process.env);

	if (!parseResult.success) {
		console.error(
			"❌ 不正な環境変数:",
			parseResult.error.flatten().fieldErrors,
			"\nデフォルトのロギング設定にフォールバックします。",
		);
		return {
			NODE_ENV: DEFAULT_NODE_ENV,
			LOG_LEVEL: DEFAULT_LOG_LEVEL,
			LOG_OUTPUT: DEFAULT_LOG_OUTPUT,
			LOG_FILE_PATH: DEFAULT_LOG_FILE_PATH,
		};
	}

	const parsedEnv = parseResult.data;
	if (parsedEnv.LOG_OUTPUT === "file") {
		parsedEnv.LOG_FILE_PATH = path.resolve(parsedEnv.LOG_FILE_PATH);
	}
	return parsedEnv;
}

/**
 * ファイルログ出力用の Pino Transport 設定オブジェクトを生成します。
 * ログディレクトリが存在しない場合は作成を試みます。
 * ディレクトリの準備に失敗した場合は undefined を返します。
 *
 * @param {string} logFilePath - ログファイルの絶対パス。
 * @returns {pino.TransportSingleOptions | undefined} ファイル Transport 設定、または失敗時に undefined。
 */
function setupLogFileTransport(
	logFilePath: string,
): pino.TransportSingleOptions | undefined {
	const logDir = path.dirname(logFilePath);

	try {
		if (!fs.existsSync(logDir)) {
			fs.mkdirSync(logDir, { recursive: true });
			console.log(`ログディレクトリを作成しました: ${logDir}`);
		}
	} catch (err) {
		console.error(
			`ログディレクトリの確認/作成中にエラーが発生しました: ${logDir}`,
			err,
		);
		return undefined;
	}

	if (!fs.existsSync(logDir)) {
		console.error(
			`ファイルロギングは無効です: ログディレクトリ ${logDir} の存在を確認できませんでした。`,
		);
		return undefined;
	}

	console.log(`ファイルにログ出力します: ${logFilePath}`);
	return {
		target: "pino/file",
		options: { destination: logFilePath, mkdir: false },
	};
}

/**
 * コンソールログ出力用の Pino Transport 設定オブジェクトを生成します。
 * 本番環境以外では pino-pretty の使用を試みます。
 * pino-pretty が利用できない場合や本番環境では、Transport 設定なし (undefined) を返します
 * (Pino のデフォルトである標準出力への JSON 出力が使用されます)。
 *
 * @param {string} nodeEnv - 現在の NODE_ENV (`development`, `production`, `test`)。
 * @returns {pino.TransportSingleOptions | undefined} コンソール Transport 設定 (pino-pretty用)、または設定不要時に undefined。
 */
function setupConsoleTransport(
	nodeEnv: string,
): pino.TransportSingleOptions | undefined {
	if (nodeEnv === "production") {
		return undefined;
	}

	try {
		require.resolve("pino-pretty");
		console.log("コンソールロギングに pino-pretty を使用します。");
		return {
			target: "pino-pretty",
			options: { colorize: true, ignore: "pid,hostname" },
		};
	} catch (e) {
		console.log(
			"pino-pretty が見つかりません。デフォルトの JSON コンソールロギングを使用します。",
		);
		return undefined;
	}
}

/**
 * NODE_ENV とログ出力先に基づいて適切な Pino Transport 設定を構成します。
 * テスト環境では Transport を設定せず、ログは標準出力に向けられます。
 *
 * @param {string} nodeEnv - 現在の NODE_ENV。
 * @param {"console" | "file"} logOutput - ログの出力先。
 * @param {string} logFilePath - ファイル出力時のログファイルパス。
 * @returns {pino.TransportSingleOptions | undefined} 構成された Transport 設定、または Transport 不要時に undefined。
 */
export function configureTransport(
	nodeEnv: string,
	logOutput: "console" | "file",
	logFilePath: string,
): pino.TransportSingleOptions | undefined {
	if (nodeEnv === "test") {
		console.log("NODE_ENV is 'test', Transport の設定を抑制します。");
		return undefined;
	}

	if (logOutput === "file") {
		return setupLogFileTransport(logFilePath);
	}

	return setupConsoleTransport(nodeEnv);
}

/**
 * プロセスの終了イベントや例外発生時にログをフラッシュし、プロセスを終了させるハンドラー。
 *
 * @param {pino.Logger} logger - 使用する Pino ロガーインスタンス。
 * @param {string} evt - 発生したイベント名 (例: 'SIGINT', 'uncaughtException')。
 * @param {Error | number | null} [err] - 関連するエラーオブジェクトまたは終了コード。
 */
function exitHandler(
	logger: pino.Logger,
	evt: string,
	err?: Error | number | null,
) {
	try {
		logger.flush();
	} catch (flushErr) {
		console.error("終了時のログフラッシュエラー:", flushErr);
	}

	const errorObj =
		err instanceof Error
			? err
			: err != null
				? new Error(`終了コードまたは理由: ${err}`)
				: null;

	console.log(`プロセス終了 (${evt})...`);

	if (errorObj) {
		console.error("終了エラー:", errorObj);
		process.removeAllListeners("uncaughtException");
		process.removeAllListeners("unhandledRejection");
		process.exit(1);
	} else {
		process.exit(0);
	}
}

/**
 * SIGINT, SIGTERM, uncaughtException, unhandledRejection イベントを捕捉し、
 * exitHandler を呼び出すリスナーをプロセスに設定します。
 * また、通常の exit イベントリスナーも設定します。
 *
 * @param {pino.Logger} logger - exitHandler に渡す Pino ロガーインスタンス。
 */
export function setupExitHandlers(logger: pino.Logger) {
	process.once("SIGINT", () => exitHandler(logger, "SIGINT"));
	process.once("SIGTERM", () => exitHandler(logger, "SIGTERM"));
	process.once("uncaughtException", (err) =>
		exitHandler(logger, "uncaughtException", err),
	);
	process.once("unhandledRejection", (reason) =>
		exitHandler(
			logger,
			"unhandledRejection",
			reason instanceof Error ? reason : new Error(String(reason)),
		),
	);

	process.on("exit", (code) => {
		console.log(
			`プロセス終了 コード: ${code}。ログはフラッシュされているはずです。`,
		);
	});
}
