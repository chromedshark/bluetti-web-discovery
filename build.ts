await Bun.build({
  entrypoints: ["./src/index.html"],
  env: "KEY_BUNDLE_*",
  define: {
    "process.env.NODE_ENV": "'production'",
  },
  outdir: "./dist",
  naming: {
    asset: "[name].[ext]",
    chunk: "[name].[ext]",
  },
  minify: true,
});

export {};
