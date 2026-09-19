import { defineConfig } from 'oxfmt';

export default defineConfig({
  experimentalSortImports: {
    groups: [
      ['side_effect'],
      ['builtin'],
      ['external', 'type-external'],
      ['internal', 'type-internal'],
      ['parent', 'type-parent'],
      ['sibling', 'type-sibling'],
      ['index', 'type-index'],
    ],
  },
  htmlWhitespaceSensitivity: 'ignore',
  ignorePatterns: ['.claude/'],
  printWidth: 120,
  singleQuote: true,
  sortPackageJson: true,
});
