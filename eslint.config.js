// Flat ESLint config (ticket #14). Kept deliberately light: tsc --noEmit is the
// primary gate for types/unused vars, ESLint catches the foot-guns.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**", "node_modules/**", "playwright-report/**",
      "test-results/**", "coverage/**", "server/node_modules/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "tests/**/*.tsx"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    rules: {
      // `any` is used deliberately at the DOM/event-bus seams; surface it as a
      // warning so `npm run lint` stays green but reviewers see the casts.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // test files intentionally use loose typing and common shorthand
      "prefer-const": "off",
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  {
    // plain JS config + server
    files: ["*.js", "server/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
