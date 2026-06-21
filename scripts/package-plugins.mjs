/**
 * Package each in-app plugin into a standalone, `lms push`-ready directory under
 * dist-plugins/.
 *
 * Why this exists: the plugins import the shared workspace package
 * @lmstudio-suite/core, which is not published to npm — so a plugin directory
 * cannot be pushed as-is. We esbuild-bundle each plugin's entry, INLINING core
 * (and its used slice only, via tree-shaking), while keeping @lmstudio/sdk and
 * zod EXTERNAL — both are provided by the LM Studio plugin runtime, and zod in
 * particular must be the SAME instance the SDK uses for tool() schema extraction.
 *
 * Output per plugin (mirrors the official lms plugin layout):
 *   dist-plugins/<name>/
 *     ├── manifest.json      (type/runner/owner/name/revision)
 *     ├── package.json       (name: lms-plugin-<name>, deps: @lmstudio/sdk + zod)
 *     ├── tsconfig.json
 *     ├── package-lock.json  (generated; required by lms push)
 *     └── src/index.ts       (self-contained bundle; only imports sdk/zod/node:*)
 *
 * Usage:
 *   node scripts/package-plugins.mjs [--owner <lms-hub-handle>] [--no-lock]
 * Then:  cd dist-plugins/<name> && lms push
 */
import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ROOT = join(ROOT, "dist-plugins");

const PLUGINS = [
  "plugin-web",
  "plugin-local",
  "plugin-memory",
  "plugin-reasoning",
  "plugin-kbmap",
  "plugin-data",
  "plugin-time",
  "plugin-schedule",
  "plugin-compact",
  "plugin-toolkit",
  "plugin-generator",
];

// Keep in lockstep with the workspace. zod must match @lmstudio/sdk's peer (^3).
const DEPS = { "@lmstudio/sdk": "^1.5.0", zod: "^3.25.76" };
const DEV_DEPS = { "@types/node": "^22.10.0" };

const args = process.argv.slice(2);
const ownerIdx = args.indexOf("--owner");
const owner = ownerIdx >= 0 ? args[ownerIdx + 1] : undefined;
const writeLock = !args.includes("--no-lock");

await rm(OUT_ROOT, { recursive: true, force: true });

for (const plugin of PLUGINS) {
  const pkgDir = join(ROOT, "packages", plugin);
  const manifest = JSON.parse(await readFile(join(pkgDir, "manifest.json"), "utf8"));
  if (owner) manifest.owner = owner;

  const outDir = join(OUT_ROOT, manifest.name);
  await mkdir(join(outDir, "src"), { recursive: true });

  const result = await esbuild.build({
    entryPoints: [join(pkgDir, "src", "index.ts")],
    outfile: join(outDir, "src", "index.ts"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["@lmstudio/sdk", "zod"],
    legalComments: "none",
    metafile: true,
    banner: {
      js: `// Bundled by lmstudio-suite (scripts/package-plugins.mjs) from packages/${plugin}. Do not edit; regenerate instead.`,
    },
  });

  // Sanity check: nothing but the intended externals + node builtins may remain.
  const imports = Object.values(result.metafile.outputs)[0]?.imports ?? [];
  const stray = imports
    .map((i) => i.path)
    .filter((p) => p !== "@lmstudio/sdk" && p !== "zod" && !p.startsWith("node:"));
  if (stray.length) {
    throw new Error(`${plugin}: unexpected un-bundled imports: ${stray.join(", ")}`);
  }

  await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(
    join(outDir, "package.json"),
    JSON.stringify(
      {
        name: `lms-plugin-${manifest.name}`,
        version: "0.1.0",
        // No "type": "module" — LM Studio bundles to a CommonJS .lmstudio/production.js
        // (it emits require() for external deps). Declaring ESM here makes Node load
        // that CJS output as an ES module and crash with "require is not defined".
        // The official plugins omit the type field for the same reason.
        main: "src/index.ts",
        scripts: { dev: "lms dev", push: "lms push" },
        dependencies: DEPS,
        devDependencies: DEV_DEPS,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    join(outDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          skipLibCheck: true,
          types: ["node"],
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(join(outDir, ".gitignore"), "node_modules/\n");

  // Copy the plugin's README into the artifact (shown on its LM Studio Hub page).
  await copyFile(join(pkgDir, "README.md"), join(outDir, "README.md")).catch(() => {
    console.warn(`  (no README.md for ${plugin})`);
  });

  if (writeLock) {
    execFileSync("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"], {
      cwd: outDir,
      stdio: "inherit",
    });
  }

  console.log(`✓ ${manifest.name}  ->  dist-plugins/${manifest.name}`);
}

console.log(
  `\nDone. To publish a plugin:\n  cd dist-plugins/<name> && lms push\n` +
    (owner ? `(owner set to "${owner}")` : `(set the correct LM Studio Hub owner with --owner, or edit manifest.json)`),
);
