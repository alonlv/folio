import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: ['cmaps', 'iccs', 'standard_fonts', 'wasm'].map(directory => ({
        src: 'node_modules/pdfjs-dist/' + directory,
        dest: 'pdfjs',
      })),
    }),
  ],
  server: { proxy: { '/api': 'http://127.0.0.1:3080' } },
  build: { target: 'es2022' },
})
