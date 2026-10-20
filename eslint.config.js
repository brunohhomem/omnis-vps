import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/drizzle/meta/**',
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  prettier,
);
