// Bundles the API for production. Third-party packages stay external (installed on Render);
// the workspace package @solace/shared is TypeScript source, so it is bundled in.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'externalize-deps',
      setup(b) {
        b.onResolve({ filter: /^[^./]|^\.[^./]|^\.\.[^/]/ }, (args) => {
          if (args.path.startsWith('@solace/')) return undefined;
          if (args.path.startsWith('node:')) return { path: args.path, external: true };
          if (/^[@a-z]/i.test(args.path)) return { path: args.path, external: true };
          return undefined;
        });
      },
    },
  ],
});
