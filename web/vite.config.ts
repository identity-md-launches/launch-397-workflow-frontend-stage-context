import { defineConfig } from 'vite'
import { readFile } from 'node:fs/promises'
export default defineConfig({
  base: './',
  plugins: [{
    name: 'serve-built-runtime-config',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0]
        if (path !== '/imd-deployment.json' && !/^\/abi\/[A-Za-z0-9_-]+\.json$/.test(path ?? '')) return next()
        try {
          const bytes = await readFile(new URL(`../dist${path}`, import.meta.url))
          res.setHeader('Content-Type', 'application/json'); res.end(bytes)
        } catch { res.statusCode = 404; res.end('Run npm run build before starting development.') }
      })
    },
  }],
  build: {
    outDir: '../dist', emptyOutDir: true, sourcemap: false,
    rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom'], ethereum: ['viem', '@wagmi/core'] } } },
  },
})
