import * as esbuild from "esbuild"

const production = process.argv.includes("--production")
const watch = process.argv.includes("--watch")

const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: "info",
}

const contexts = await Promise.all([
  esbuild.context({
    ...common,
    entryPoints: ["src/extension.ts"],
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile: "dist/extension.js",
    external: ["vscode"],
  }),
  esbuild.context({
    ...common,
    entryPoints: ["webview/main.ts"],
    platform: "browser",
    format: "iife",
    target: "es2022",
    outfile: "dist/webview.js",
  }),
])

if (watch) {
  await Promise.all(contexts.map((context) => context.watch()))
} else {
  await Promise.all(contexts.map((context) => context.rebuild()))
  await Promise.all(contexts.map((context) => context.dispose()))
}
