import pino from "pino";
import * as path from "node:path";
import * as fs from "node:fs";

// --- Configuration ---

const DEFAULT_LOG_LEVEL: pino.Level = "info";
const DEFAULT_LOG_OUTPUT: "console" | "file" = "console";
const DEFAULT_LOG_FILE_PATH = path.resolve(process.cwd(), "app.log");

const logLevel = (process.env.LOG_LEVEL as pino.Level) ?? DEFAULT_LOG_LEVEL;
const logOutput =
	(process.env.LOG_OUTPUT as "console" | "file") ?? DEFAULT_LOG_OUTPUT;
const logFilePath = process.env.LOG_FILE_PATH ?? DEFAULT_LOG_FILE_PATH;

// --- Pino Options ---

const pinoOptions: pino.LoggerOptions = {
	level: logLevel,
	base: {
		pid: process.pid,
		// hostname: os.hostname(), // os import might be needed
	},
	timestamp: pino.stdTimeFunctions.isoTime,
	formatters: {
		level: (label) => {
			return { level: label.toUpperCase() };
		},
	},
};

// --- Transport ---

let transport: pino.TransportSingleOptions | undefined;

if (logOutput === "file") {
	const logDir = path.dirname(logFilePath);
	if (!fs.existsSync(logDir)) {
		try {
			fs.mkdirSync(logDir, { recursive: true });
		} catch (err) {
			console.error(`Failed to create log directory: ${logDir}`, err);
			transport = { target: "pino-pretty" }; // Fallback to console
		}
	}

	if (!transport) {
		transport = {
			target: "pino/file",
			options: { destination: logFilePath, mkdir: true },
		};
		console.log(`Logging to file: ${logFilePath}`);
	}
} else {
	if (process.env.NODE_ENV !== "production") {
		try {
			require.resolve("pino-pretty");
			transport = {
				target: "pino-pretty",
				options: {
					colorize: true,
					// translateTime: 'SYS:standard',
					ignore: "pid,hostname",
				},
			};
			console.log("Using pino-pretty for console logging.");
		} catch (e) {
			console.log("pino-pretty not found, using default JSON console logging.");
		}
	}
}

// --- Logger Instance & Exit Handling ---

const baseLogger = transport
	? pino(pinoOptions, pino.transport(transport))
	: pino(pinoOptions);

// ★ イベントリスナーで終了処理をハンドリング ★
const exitHandler = (evt: string, err?: Error | number | null) => {
	// Note: logger.flush() is synchronous
	try {
		baseLogger.flush();
	} catch (flushErr) {
		console.error("Error flushing logs on exit:", flushErr);
	}

	const errorObj =
		err instanceof Error
			? err
			: err != null
				? new Error(`Exit code or reason: ${err}`)
				: null;
	console.log(`Process exiting due to ${evt}...`);

	if (errorObj) {
		console.error(errorObj);
		// Avoid recursion if exitHandler is called again during exit
		process.removeAllListeners("uncaughtException");
		process.removeAllListeners("unhandledRejection");
		process.exit(1);
	} else {
		process.exit(0);
	}
};

process.once("SIGINT", () => exitHandler("SIGINT"));
process.once("SIGTERM", () => exitHandler("SIGTERM"));

process.once("uncaughtException", (err) =>
	exitHandler("uncaughtException", err),
);
process.once("unhandledRejection", (reason) =>
	exitHandler(
		"unhandledRejection",
		reason instanceof Error ? reason : new Error(String(reason)),
	),
);

// Normal exit event (less reliable for async operations like flushing)
process.on("exit", (code) => {
	console.log(
		`Process exited with code ${code}. Logs should have been flushed.`,
	);
});

baseLogger.info(
	{
		logLevel,
		logOutput,
		logFilePath: logOutput === "file" ? logFilePath : undefined,
		nodeEnv: process.env.NODE_ENV,
	},
	"Logger initialized",
);

// ★ 通常使用するロガーとして baseLogger をエクスポート ★
export default baseLogger;
