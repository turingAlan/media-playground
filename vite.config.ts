import { cloudflare } from '@cloudflare/vite-plugin'
import contentCollections from '@content-collections/vite'
import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import type { Connect } from 'vite'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

/** Vite plugin: inject COOP/COEP headers needed for SharedArrayBuffer (FFmpeg WASM) */
function coopCoepPlugin() {
  return {
    name: 'coop-coep-headers',
    configureServer(server: { middlewares: { use: (fn: Connect.HandleFunction) => void } }) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
        next()
      })
    },
  }
}

const config = defineConfig({
  plugins: [
    coopCoepPlugin(),
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    contentCollections(),
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart(),
    viteReact({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core', '@ffmpeg/core-mt'],
  },
})

export default config
