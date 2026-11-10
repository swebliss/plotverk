// Mirrors the Obsidian community directory's automated review (newest layer),
// so warnings show up here before a release is uploaded. Run: npm run lint
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },

  ...obsidianmd.configs.recommended,

  {
    files: ["**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}"],
    rules: {
      "no-eval": "error",
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      "obsidianmd/regex-lookbehind": "error",
      "obsidianmd/no-forbidden-elements": "error",

      "no-undef": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "import/no-unresolved": "off",

      // Newest scanner layer: these come back as warnings
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
    },
  },
  {
    files: ["**/*.{ts,cts,mts,tsx}"],
    rules: { "@typescript-eslint/no-implied-eval": "error" },
  },
  { files: ["manifest.json"], rules: { "obsidianmd/validate-manifest": "off" } },
  { files: ["LICENSE", "LICENSE.md", "LICENSE.txt"], rules: { "obsidianmd/validate-license": "off" } },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
      reportUnusedInlineConfigs: "off",
    },
  },

  globalIgnores([
    "main.js",
    "**/*.min.js",
    "**/{dist,build,out,release}/**/*.{js,cjs,mjs,jsx}",
    "node_modules",
    "dist",
    "build",
    "pkg",
    ".obsidian",
    "**/.obsidian/**",
    "esbuild.config.mjs",
    "**/*.test.*",
    "**/*.spec.*",
    "**/test/**",
    "**/tests/**",
    "**/__tests__/**",
    "**/mocks/**",
    "**/__mocks__/**",
    "**/*.cjs",
    "**/*.mjs",
    "**/scripts/**",
    "**/docs/**",
    "**/i18n/**",
    "**/locales/**",
    "**/translations/**",
    "**/jest.config.*",
    "**/eslint.config.*",
    // Not shipped in the public release (make-release leaves these out)
    "Beta/**",
    "release/**",
    "src/prose/pro/**",
    "undefined.probes/**",
  ]),
]);
