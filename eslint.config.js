import js from "@eslint/js";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2021,
      sourceType: "module",
      globals: {
        ...globals.browser,
        browser: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      curly: "error",
      eqeqeq: "error",
      "no-unused-vars": "off",
      "no-console": "warn",
      "no-empty": "off",
      semi: ["error", "always"],
      quotes: ["error", "double"],
      indent: ["error", 2, { "SwitchCase": 1 }],
      "arrow-parens": ["error", "as-needed"],
      "comma-dangle": ["error", "always-multiline"],
      "object-curly-spacing": ["error", "always"],
      "array-bracket-spacing": ["error", "never"],
      "space-before-blocks": ["error", "always"],
      "keyword-spacing": ["error", { before: true, after: true }],
      "space-infix-ops": "error",
      "no-multiple-empty-lines": ["error", { max: 1 }],
      "eol-last": ["error", "always"],
      // TypeScript-specific rules
      "@typescript-eslint/no-unused-vars": ["warn"],
      "@typescript-eslint/explicit-function-return-type": ["warn"],
      "@typescript-eslint/no-explicit-any": ["warn"],
      "@typescript-eslint/typedef": [
        "warn",
        {
          variableDeclaration: true,
          propertyDeclaration: true,
          parameter: true,
          memberVariableDeclaration: true,
          arrowParameter: false,
          arrayDestructuring: true,
          objectDestructuring: true,
        },
      ],
      "padding-line-between-statements": [
        "error",
        // Blank line before and after block-like statements
        { "blankLine": "always", "prev": "*", "next": ["if", "for", "while", "function", "class", "switch", "try"] },
        { "blankLine": "always", "prev": ["if", "for", "while", "function", "class", "switch", "try"], "next": "*" },
      ],
    },
  },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      globals: {
        ...globals.browser,
        browser: "readonly",
      },
    },
    rules: {
      curly: "error",
      eqeqeq: "error",
      "no-unused-vars": "warn",
      "no-console": "warn",
      "no-empty": "off",
      semi: ["error", "always"],
      quotes: ["error", "double"],
      indent: ["error", 2, { "SwitchCase": 1 }],
      "arrow-parens": ["error", "as-needed"],
      "comma-dangle": ["error", "always-multiline"],
      "object-curly-spacing": ["error", "always"],
      "array-bracket-spacing": ["error", "never"],
      "space-before-blocks": ["error", "always"],
      "keyword-spacing": ["error", { before: true, after: true }],
      "space-infix-ops": "error",
      "no-multiple-empty-lines": ["error", { max: 1 }],
      "eol-last": ["error", "always"],
      "padding-line-between-statements": [
        "error",
        { "blankLine": "always", "prev": "*", "next": ["if", "for", "while", "function", "class", "switch", "try"] },
        { "blankLine": "always", "prev": ["if", "for", "while", "function", "class", "switch", "try"], "next": "*" },
      ],
    },
  },
  {
    ignores: ["**/node_modules/**", "**/web-ext-artifacts/**", "**/*.min.js"],
  },
];
