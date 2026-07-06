import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // TEMPORARY: keep this off while diagnosing the "more hooks than
    // previous render" bug — it makes error stack traces show real
    // function/component names instead of mangled ones like "$0"/"L0".
    // Safe to turn back on (minify: true, or remove this block) once
    // the bug is found and fixed.
    minify: false,
  },
});
