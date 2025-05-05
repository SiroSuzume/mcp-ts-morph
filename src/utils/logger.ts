import pino from "pino";
import {
	configureTransport,
	parseEnvVariables,
	setupExitHandlers,
} from "./logger-helpers";

const env = parseEnvVariables();

const isTestEnv = env.NODE_ENV === "test";

const pinoOptions: pino.LoggerOptions = {
	level: isTestEnv ? "silent" : env.LOG_LEVEL,
	base: { pid: process.pid },
	timestamp: pino.stdTimeFunctions.isoTime,
	formatters: {
		level: (label) => ({ level: label.toUpperCase() }),
	},
};

const transport = !isTestEnv
	? configureTransport(env.NODE_ENV, env.LOG_OUTPUT, env.LOG_FILE_PATH)
	: undefined;

const baseLogger = transport
	? pino(pinoOptions, pino.transport(transport))
	: pino(pinoOptions);

setupExitHandlers(baseLogger);

// テスト環境では初期化ログを出力しない
if (!isTestEnv) {
	baseLogger.info(
		{
			logLevel: env.LOG_LEVEL,
			logOutput: env.LOG_OUTPUT,
			logFilePath: env.LOG_OUTPUT === "file" ? env.LOG_FILE_PATH : undefined,
			nodeEnv: env.NODE_ENV,
		},
		"ロガー初期化完了",
	);
}

export default baseLogger;
