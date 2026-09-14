import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next 16.x ships native flat-config exports (verified:
// both are proper arrays at runtime). Deliberately NOT using
// `FlatCompat(...).extends("next/core-web-vitals", "next/typescript")`
// (the pattern shown in most older tutorials/Next.js docs snippets) —
// that legacy-compat path crashes here with "TypeError: Converting
// circular structure to JSON" inside @eslint/eslintrc's config validator,
// triggered by eslint-plugin-react's own flat config having a circular
// self-reference that the legacy validator's error-formatting code can't
// serialize. Importing the flat exports directly avoids that compat layer
// entirely.
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", "playwright-report/**", "test-results/**"],
  },
];

export default eslintConfig;
