import eslint from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import jsdocPlugin from 'eslint-plugin-jsdoc';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      import: importPlugin,
      jsdoc: jsdocPlugin
    },
    settings: {
      'import/resolver': {
        node: {
          extensions: ['.js', '.mjs']
        }
      }
    },
    rules: {
      ...eslint.configs.recommended.rules,
      ...importPlugin.configs.recommended.rules,
      ...jsdocPlugin.configs.recommended.rules,
      ...prettierConfig.rules,
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/no-undefined-types': 'warn'
    }
  },
  {
    files: ['sw.js'],
    languageOptions: {
      globals: globals.serviceworker
    }
  }
];
