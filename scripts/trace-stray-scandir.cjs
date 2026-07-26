/**
 * Diagnostic preload for the Windows build failure.
 *
 * `next build` dies on the GitHub Windows runner with:
 *   EPERM: operation not permitted, scandir 'C:\Users\runneradmin\Application Data'
 *
 * `Application Data` is a legacy junction in the Windows user profile that
 * loops back on itself and denies enumeration, so *any* directory walk that
 * reaches the user profile fails there. The open question is which walk: the
 * error comes from next/dist/compiled/glob, and Next's two glob call sites are
 * both bounded to the project directory, so something else is starting a scan
 * outside it. The message carries no stack, which is why this exists.
 *
 * Wraps the fs directory-reading calls and prints a stack the moment one is
 * asked for a path outside the project. Load it with:
 *
 *   NODE_OPTIONS="--require ./scripts/trace-stray-scandir.cjs"
 *
 * Diagnostic only — never load this from a release build.
 */

/* eslint-disable @typescript-eslint/no-require-imports --
   This is a CJS preload loaded through `node --require`, which runs before ESM
   is available, so `import` is not an option here. */
const fs = require("node:fs");
const path = require("node:path");

const projectDir = path.resolve(__dirname, "..");
const seen = new Set();

function isStray(target) {
  if (typeof target !== "string" || target.length === 0) return false;
  let resolved;
  try {
    resolved = path.resolve(target);
  } catch {
    return false;
  }
  // Anything inside the checkout is expected; anything outside is the bug.
  const relative = path.relative(projectDir, resolved);
  return relative.startsWith("..") || path.isAbsolute(relative);
}

function report(fnName, target) {
  const key = `${fnName}:${path.resolve(target)}`;
  if (seen.has(key)) return;
  seen.add(key);

  // Drop this module's own frames so the first line is the actual caller.
  const stack = (new Error().stack ?? "")
    .split("\n")
    .filter((line) => !line.includes("trace-stray-scandir.cjs"))
    .slice(1)
    .join("\n");

  console.error(
    [
      "",
      "=== stray scan outside the project ===",
      `  call:    fs.${fnName}`,
      `  path:    ${path.resolve(target)}`,
      `  project: ${projectDir}`,
      `  cwd:     ${process.cwd()}`,
      stack,
      "======================================",
      "",
    ].join("\n"),
  );
}

// Only directory enumeration: the failing syscall is scandir, and intercepting
// realpath as well drowns the output in Node's own module resolution.
for (const fnName of ["readdir", "readdirSync", "opendir", "opendirSync"]) {
  const original = fs[fnName];
  if (typeof original !== "function") continue;

  fs[fnName] = function patched(target, ...rest) {
    if (isStray(target)) report(fnName, target);
    return original.call(this, target, ...rest);
  };
  // Preserve `fs.realpath.native` and friends.
  Object.assign(fs[fnName], original);
}

const promisesOriginal = fs.promises;
for (const fnName of ["readdir", "opendir"]) {
  const original = promisesOriginal[fnName];
  if (typeof original !== "function") continue;

  promisesOriginal[fnName] = function patched(target, ...rest) {
    if (isStray(target)) report(`promises.${fnName}`, target);
    return original.call(this, target, ...rest);
  };
}

// The stray walks all originate in @vercel/nft calling next's bundled glob, but
// the stack stops inside glob's async internals — it never shows the pattern
// that started it. Hook the module loader to capture pattern + cwd at call time.
const Module = require("node:module");
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  const exported = originalLoad.call(this, request, parent, isMain);
  if (!request.includes("compiled/glob") || typeof exported !== "function" || exported.__patched) {
    return exported;
  }

  const wrapped = function tracedGlob(pattern, options, callback) {
    const cwd = (options && options.cwd) || process.cwd();
    console.error(
      `[glob] pattern=${JSON.stringify(pattern)} cwd=${JSON.stringify(cwd)}` +
        ` caller=${(new Error().stack ?? "").split("\n")[2]?.trim() ?? "?"}`,
    );
    return exported.call(this, pattern, options, callback);
  };
  Object.assign(wrapped, exported);
  wrapped.__patched = true;
  return wrapped;
};

console.error(`[trace-stray-scandir] armed — project=${projectDir} cwd=${process.cwd()}`);
