import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import globals from "globals";

export default [
  // Apply to all TypeScript and JavaScript files
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.node,
        ...globals.browser,
        NodeJS: "readonly",
        Bun: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // Base ESLint recommended rules
      ...js.configs.recommended.rules,

      // TypeScript ESLint recommended rules
      ...tseslint.configs.recommended.rules,

      // Custom rules from the original configuration
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "no-useless-catch": "off",
      "no-constant-condition": "off",
      "prefer-const": "warn",
      "@typescript-eslint/no-unsafe-declaration-merging": "off",
      "no-useless-escape": "off",
      "no-case-declarations": "off",
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": "off",
    },
  },

  // Ignore patterns
  {
    ignores: [
      "node_modules/**",
      "target/**",
      "dist/**",
      "*.d.ts",
      "coverage/**",
    ],
  },
];
