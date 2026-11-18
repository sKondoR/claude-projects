import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'electron-vite';

export default defineConfig({
	main: {
		define: { __RULES_DIR__: JSON.stringify(resolve('rules')) },
	},
	preload: {},
	renderer: {
		plugins: [svelte()],
	},
});
