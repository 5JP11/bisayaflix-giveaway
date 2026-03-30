import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin-control.html'),
        roulette: resolve(__dirname, 'public-roulette.html'),
      },
    },
  },
})
