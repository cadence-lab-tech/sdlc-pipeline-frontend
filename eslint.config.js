import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {ignores: ['dist']},
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {ecmaVersion: 2022, globals: globals.browser},
    plugins: {'react-hooks': reactHooks, 'react-refresh': reactRefresh},
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', {allowConstantExport: true}],
    },
  },
  {
    // Компоненты shadcn — вендорные исходники: они экспортируют рядом с
    // компонентами варианты и хуки, и переписывать их под правило значит
    // расходиться с тем, что положит следующий `shadcn add`.
    files: ['src/components/ui/**', 'src/lib/theme.tsx'],
    rules: {'react-refresh/only-export-components': 'off'},
  },
);
