import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Voice UI kit sources (copied from pipecat-examples/phonellm): keep them
    // as shipped rather than rewriting them to satisfy local lint rules.
    files: [
      'src/components/ui/**',
      'src/components/pipecat/**',
      'src/components/spellspeak/**',
      'src/hooks/use-pipecat-*.ts',
      'src/hooks/use-session.ts',
      'src/hooks/use-tool-calls.ts',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/immutability': 'off',
    },
  },
])
