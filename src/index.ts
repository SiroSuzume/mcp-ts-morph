import { runStdioServer } from "./mcp/stdio";

// サーバー起動
runStdioServer().catch((error: Error) => {
	process.stderr.write(JSON.stringify({ error: `Fatal error: ${error}` }));
	process.exit(1);
});
