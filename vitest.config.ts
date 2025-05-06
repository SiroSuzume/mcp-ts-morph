import { defineConfig } from "vitest/config";

// https://vitejs.dev/config/
export default defineConfig({
	test: {
		env: {
			API_ADDRESS: "http://localhost:8080",
		},
		restoreMocks: true,
		mockReset: true,
		clearMocks: true,
		coverage: {
			reporter: ["text", "json-summary", "html"],
		},
	},
});
