import path from 'path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import svgr from 'vite-plugin-svgr';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), 'AGENTSCOPE_');
	const proxy = {
		'/api': {
			target:
				process.env.AGENTSCOPE_BACKEND_URL ||
				env.AGENTSCOPE_BACKEND_URL ||
				'http://127.0.0.1:8000',
			// Preserve the public Host so Origin/CSRF checks work through the proxy.
			changeOrigin: false,
			rewrite: (url: string) => url.replace(/^\/api(?=\/|$)/, '') || '/',
		},
	};
	return {
		plugins: [react(), tailwindcss(), svgr()],
		server: {
			proxy,
		},
		preview: { proxy },
		resolve: {
			alias: {
				'@': path.resolve(__dirname, './src'),
				'next/navigation': path.resolve(__dirname, './src/lib/next-navigation-shim.ts'),
			},
		},
		optimizeDeps: {
			include: ['mime-types'],
		},
	};
});
