import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // Files/dirs to never lint
  { ignores: ["dist", "node_modules", "*.config.js", "*.config.ts"] },

  // TypeScript source files
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // React Hooks rules
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Only exports from React components; avoids HMR churn
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // Unused variables: allow leading-underscore names as intentional ignores
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // console.warn / console.error are used intentionally in transit.ts frameLog
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // Type assertions are used sparingly with crypto types — allow but warn on `any`
      "@typescript-eslint/no-explicit-any": "warn",

      // `void expr` is used intentionally throughout for fire-and-forget async calls
      // (e.g. `void channel.unsubscribe()`, `void flushDesk(ch)`, JSX callbacks).
      // Disabling entirely because `allowAsStatement: true` doesn't cover JSX callbacks.
      "no-void": "off",
    },
  },

  // Test files: relax a few rules that are noisy in unit tests
  {
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Prettier must be last — disables all formatting-related ESLint rules
  prettierConfig,
);
