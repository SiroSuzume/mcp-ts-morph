import pino from "pino";
import {
	configureTransport,
	parseEnvVariables,
	setupExitHandlers,
} from "./logger-helpers";

const env = parseEnvVariables();

const pinoOptions: pino.LoggerOptions = {
	level: env.LOG_LEVEL,
	base: { pid: process.pid },
	timestamp: pino.stdTimeFunctions.isoTime,
	formatters: {
		level: (label) => ({ level: label.toUpperCase() }),
	},
};

const transport = configureTransport(
	env.NODE_ENV,
	env.LOG_OUTPUT,
	env.LOG_FILE_PATH,
);

const baseLogger = transport
	? pino(pinoOptions, pino.transport(transport))
	: pino(pinoOptions);

setupExitHandlers(baseLogger);

baseLogger.info(
	{
		logLevel: env.LOG_LEVEL,
		logOutput:
			env.NODE_ENV !== "test" ? env.LOG_OUTPUT : "stdout (test default)",
		logFilePath:
			env.NODE_ENV !== "test" && env.LOG_OUTPUT === "file"
				? env.LOG_FILE_PATH
				: undefined,
		nodeEnv: env.NODE_ENV,
	},
	"ロガー初期化完了",
);

export default baseLogger;
