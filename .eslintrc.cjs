module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.eslint.json",
    tsconfigRootDir: __dirname,
    ecmaVersion: 2022,
    sourceType: "module",
  },
  extends: ["airbnb-typescript/base"],
  plugins: ["import"],
  settings: {
    "import/resolver": {
      typescript: {
        project: "./tsconfig.eslint.json",
      },
    },
  },
  // Third-party-generated DTOs are linted by their generator, checked for drift, and typechecked.
  // Lint hand-written boundary adapters normally; do not reformat emitted code.
  ignorePatterns: ["dist/", "node_modules/", "src/generated/ace-gateway/"],
  rules: {
    "@typescript-eslint/no-use-before-define": "off",
    "class-methods-use-this": "off",
    "import/extensions": ["error", "ignorePackages", { "ts": "never" }],
    "import/prefer-default-export": "off",
    "max-classes-per-file": "off",
    "no-await-in-loop": "off",
    "no-plusplus": "off",
    "no-restricted-syntax": "off",
    "no-underscore-dangle": "off",
  },
};
