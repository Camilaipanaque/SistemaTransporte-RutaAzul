import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const pagesBase = process.env.GITHUB_ACTIONS === 'true'
  ? `/${process.env.GITHUB_REPOSITORY?.split('/').at(-1) || 'SistemaTransporte'}/`
  : '/'

export default defineConfig({ base: pagesBase, plugins: [vue()] })
