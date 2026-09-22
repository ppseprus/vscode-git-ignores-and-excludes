import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'
import perfectionist from 'eslint-plugin-perfectionist'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['out/', 'node_modules/']),
  js.configs.recommended,
  stylistic.configs.customize({
    semi: false,
    quotes: 'single',
    indent: 2,
    commaDangle: 'never',
    arrowParens: true,
    braceStyle: '1tbs'
  }),
  {
    plugins: { perfectionist },
    rules: {
      '@stylistic/operator-linebreak': ['error', 'after', { overrides: { '?': 'before', ':': 'before' } }],
      'perfectionist/sort-modules': ['error', {
        type: 'unsorted',
        groups: [
          ['declare-enum', 'export-enum', 'enum', 'declare-interface', 'export-interface', 'interface', 'declare-type', 'export-type', 'type'],
          ['declare-class', 'export-class', 'class', 'declare-function', 'export-function', 'function']
        ]
      }]
    }
  },
  {
    files: ['src/**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // A condition says what it tests: `list.length > 0`, not `list.length`.
      '@typescript-eslint/strict-boolean-expressions': ['error', { allowString: false, allowNumber: false }]
    }
  },
  {
    files: ['test/**/*.{mjs,cjs}', 'eslint.config.mjs'],
    languageOptions: { globals: globals.node }
  }
])
