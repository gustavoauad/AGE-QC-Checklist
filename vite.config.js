import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Inject no-cache meta into index.html so browsers always revalidate
// the entry point after deploys (prevents blank page from stale cached HTML)
const noCacheHtmlPlugin = () => ({
  name: 'no-cache-html',
  transformIndexHtml(html) {
    return html.replace(
      '<meta charset="UTF-8" />',
      '<meta charset="UTF-8" />\n    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />\n    <meta http-equiv="Pragma" content="no-cache" />\n    <meta http-equiv="Expires" content="0" />'
    )
  },
})

export default defineConfig({
  plugins: [react(), noCacheHtmlPlugin()],
  base: '/AGE-QAQC-Checklist/',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
})