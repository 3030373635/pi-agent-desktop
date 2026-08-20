import { fileURLToPath } from "node:url";

const chrome102CompatPath = fileURLToPath(
  new URL("./scripts/postcss-chrome-102-compat.cjs", import.meta.url),
);

/** @type {import('postcss').Config} */
const config = {
  plugins: ["@tailwindcss/postcss", chrome102CompatPath],
};

export default config;
