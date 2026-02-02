import {
    defineConfig,
    globalIgnores,
} from "eslint/config";

import tsParser from "@typescript-eslint/parser";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import jest from "eslint-plugin-jest";
import globals from "globals";
import js from "@eslint/js";

import {
    FlatCompat,
} from "@eslint/eslintrc";

const compat = new FlatCompat({
    baseDirectory: import.meta.dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default defineConfig([{
    extends: compat.extends(
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:eslint-plugin-jest/recommended",
        "eslint-config-prettier",
    ),

    languageOptions: {
        parser: tsParser,

        globals: {
            ...globals.node,
            ...jest.environments.globals.globals,
        },
    },

    plugins: {
        "@typescript-eslint": typescriptEslint,
        jest,
    },

    rules: {
        "@typescript-eslint/no-require-imports": "error",
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-empty-function": "off",

        "@typescript-eslint/ban-ts-comment": ["error", {
            "ts-ignore": "allow-with-description",
        }],

        "no-console": "error",
        "yoda": "error",

        "prefer-const": ["error", {
            destructuring: "all",
        }],

        "no-control-regex": "off",

        "no-constant-condition": ["error", {
            checkLoops: false,
        }],
    },
}, {
    files: ["**/*{test,spec}.ts"],

    rules: {
        "@typescript-eslint/no-unused-vars": "off",
        "jest/no-standalone-expect": "off",
        "jest/no-conditional-expect": "off",
        "no-console": "off",
    },
}, globalIgnores(["**/dist/", "**/lib/", "**/node_modules/", "**/jest.config.mjs", "**/jest.setup.js"])]);
