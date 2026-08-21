import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/", "fixtures/", "coverage/", "tools/oxlint/anti-slop/"],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  prettier,
);
