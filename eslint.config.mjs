// Atlas ESLint flat config — enforces the docs/16 coding standards.
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.next/**", "**/coverage/**"],
  },
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // docs/16 CS-3: `any` is banned (use `unknown` + narrowing)
      "@typescript-eslint/no-explicit-any": "error",
      // docs/16: no swallowed/unused; allow intentional _-prefixed
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // docs/16 CS-2: prefer explicit, no non-null assertion without reason
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },
);
