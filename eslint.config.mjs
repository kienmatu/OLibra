import next from "eslint-config-next";

/**
 * eslint-config-next v16 ships a native flat config array, so it is spread
 * directly — no @eslint/eslintrc FlatCompat wrapper, which breaks under
 * ESLint 10.
 */
const config = [
  {
    ignores: [".next/**", "out/**", "build/**", "node_modules/**", "next-env.d.ts"],
  },
  ...next,
  {
    rules: {
      // Vietnamese prose is full of apostrophes and quotation marks; escaping
      // them in JSX costs more readability than it buys.
      "react/no-unescaped-entities": "off",
    },
  },
];

export default config;
