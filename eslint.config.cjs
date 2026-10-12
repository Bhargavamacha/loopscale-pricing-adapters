const js = require('@eslint/js');
const { rules } = require('eslint-plugin-react');
const tseslint = require('typescript-eslint');

module.exports = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // handlers share one signature; unused params are marked with a leading underscore
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
    }
  },
];
