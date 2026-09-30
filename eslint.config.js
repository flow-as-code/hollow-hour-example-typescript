/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// Flat config (ESLint 10), copied from flow-as-code's and kept close to
// recommended: codegen output in flows/ must pass it untouched, so stylistic
// opinions live in Prettier, not here.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/coverage/**",
      "build/**",
      "**/.vitest/**",
      "**/.terraform/**",
      ".claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // FlowDoc `content` is arbitrary Connect Flow language; generic blocks
      // legitimately carry values the builder does not model.
      "@typescript-eslint/no-explicit-any": "off",
      eqeqeq: ["error", "always"],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // Console programs: the generator and the repo scripts.
    files: ["generators/**/*.ts", "scripts/**/*.mjs", "**/*.test.ts"],
    rules: { "no-console": "off" },
  },
);
