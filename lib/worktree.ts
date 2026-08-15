import { execFile } from "child_process";
import { existsSync, mkdirSync, realpathSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { promisify } from "util";
import { allowFileRoot } from "./allowed-roots";

const execFileAsync = promisify(execFile);

// ============================================================================
// Project resolution: cwd → { projectRoot, branch }
//
// A worktree's `git rev-parse --git-common-dir` points at the *main* repo's
// .git directory, so its parent is the project root shared by all worktrees.
// Non-git directories resolve to themselves. Results are cached on globalThis
// (hot-reload safe) with a short TTL; add/remove worktree invalidates eagerly.
// ============================================================================

export interface ProjectInfo {
  projectRoot: string;
  /** Current branch of the cwd, null for non-git dirs or detached HEAD */
  branch: string | null;
  /** True when cwd is a linked worktree (not the main checkout) */
  isWorktree: boolean;
  /** True when cwd is the top-level directory of a checkout (main or linked).
   *  False for repo subdirectories and non-git dirs — the worktree switcher
   *  is only meaningful at the top level. */
  isTopLevel: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  isMain: boolean;
}

declare global {
  var __piProjectCache: Map<string, { info: ProjectInfo; expiresAt: number }> | undefined;
}

const PROJECT_CACHE_TTL_MS = 60_000;

function getProjectCache(): Map<string, { info: ProjectInfo; expiresAt: number }> {
  if (!globalThis.__piProjectCache) globalThis.__piProjectCache = new Map();
  return globalThis.__piProjectCache;
}

export function invalidateProjectCache(): void {
  globalThis.__piProjectCache?.clear();
}

async function git(cwd: string, args: string[], timeoutMs = 10_000): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    // Pin the message locale so error-text matching (e.g. the dirty-worktree
    // detection in the DELETE route) works regardless of system language.
    // GIT_TERMINAL_PROMPT=0 makes credential-hungry network commands (fetch)
    // fail fast instead of blocking the timeout on an invisible prompt.
    env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout.trim();
}

/**
 * addWorktree() places worktrees in `<repoRoot>-worktrees/<dir>`. When such a
 * directory no longer exists (worktree removed), group its sessions back
 * under the main repo instead of letting them dangle as a phantom project.
 * The dir name is the sanitized branch name — close enough for display.
 */
function inferRemovedWorktree(cwd: string): ProjectInfo | null {
  const parent = dirname(cwd);
  if (!parent.endsWith("-worktrees")) return null;
  const repoRoot = parent.slice(0, -"-worktrees".length);
  if (!repoRoot || !existsSync(join(repoRoot, ".git"))) return null;
  return { projectRoot: repoRoot, branch: basename(cwd), isWorktree: true, isTopLevel: true };
}

export async function resolveProject(cwd: string): Promise<ProjectInfo> {
  const cache = getProjectCache();
  const cached = cache.get(cwd);
  if (cached && cached.expiresAt > Date.now()) return cached.info;

  let info: ProjectInfo;
  try {
    if (!existsSync(cwd)) {
      info = inferRemovedWorktree(cwd) ?? { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
      cache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
      return info;
    }
    const out = await git(cwd, [
      "rev-parse", "--path-format=absolute",
      "--git-common-dir", "--git-dir", "--show-toplevel",
      "--abbrev-ref", "HEAD",
    ]);
    const [commonDir, gitDir, toplevel, ref] = out.split("\n").map((l) => l.trim());
    // git prints resolved (symlink-free) paths; normalize cwd the same way
    let realCwd = cwd;
    try { realCwd = realpathSync(cwd); } catch { /* keep as-is */ }
    // For a linked worktree, --git-dir differs from --git-common-dir.
    // Only collapse *worktree toplevels* into the main repo. A session whose
    // cwd is a subdirectory of a repo keeps its own project identity —
    // grouping subdirs under the repo root would change where new sessions
    // are created for existing users.
    const isTopLevel = toplevel === realCwd;
    const isWorktreeTopLevel = gitDir !== commonDir && isTopLevel;
    info = {
      projectRoot: isWorktreeTopLevel ? dirname(commonDir) : cwd,
      branch: ref && ref !== "HEAD" ? ref : null,
      isWorktree: isWorktreeTopLevel,
      isTopLevel,
    };
  } catch {
    info = { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
  }

  cache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
  return info;
}

// ============================================================================
// Worktree operations
//
// These take any directory inside the repo (a worktree, the main checkout, or
// a subdirectory) and resolve the main repo root themselves via the git
// common dir, so callers can pass session cwds directly.
// ============================================================================

/** Main repo root (parent of the shared .git dir), or throws for non-git dirs */
async function getRepoRoot(cwd: string): Promise<string> {
  const commonDir = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return dirname(commonDir);
}

export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const out = await git(cwd, ["worktree", "list", "--porcelain"]);
  const worktrees: WorktreeInfo[] = [];
  let current: (Partial<WorktreeInfo> & { prunable?: boolean }) | null = null;

  const flush = () => {
    if (current?.path) {
      // Prunable worktrees point at missing/broken gitdirs and cannot be
      // browsed or selected usefully. Also skip vanished paths even if git has
      // not marked them prunable yet.
      if (!current.prunable && existsSync(current.path)) {
        worktrees.push({
          path: current.path,
          branch: current.branch ?? null,
          isMain: worktrees.length === 0,
        });
      }
    }
    current = null;
  };

  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: line.slice("worktree ".length).trim() };
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    } else if (line.startsWith("prunable") && current) {
      current.prunable = true;
    } else if (line.trim() === "") {
      flush();
    }
  }
  flush();
  return worktrees;
}

function sanitizeBranchForDir(branch: string): string {
  return branch.replace(/[\/\\:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Local branch names for the worktree create UI (newest tip first, capped). */
export async function listLocalBranches(cwd: string, limit = 40): Promise<string[]> {
  const repoRoot = await getRepoRoot(cwd);
  const out = await git(repoRoot, [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname:short)",
    "refs/heads",
  ]);
  const branches: string[] = [];
  const seen = new Set<string>();
  for (const line of out.split("\n")) {
    const name = line.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    branches.push(name);
    if (branches.length >= limit) break;
  }
  return branches;
}

// ============================================================================
// Branch switching in the current checkout
//
// The worktree switcher covers branches that already have a checkout; these
// helpers cover switching the *current* checkout to another branch in place,
// including remote-only branches (checked out with a local tracking branch).
// ============================================================================

/** Strip the remote prefix from "<remote>/<branch>" ("origin/feature/x" → "feature/x"). */
export function stripRemotePrefix(ref: string): string | null {
  const slash = ref.indexOf("/");
  if (slash <= 0) return null;
  const name = ref.slice(slash + 1);
  // <remote>/HEAD is a symbolic pointer, not a checkoutable branch
  if (!name || name === "HEAD") return null;
  return name;
}

/** Remote-tracking refs (short "<remote>/<branch>" names) that end in `branch`.
 *  More than one match means the name is ambiguous across remotes. */
export function matchRemoteRefs(refs: string[], branch: string): string[] {
  return refs.filter((ref) => stripRemotePrefix(ref) === branch);
}

/**
 * Split raw local + remote ref lists into the switcher's two sections:
 * `local` as-is, and `remoteOnly` holding remote branches (prefix stripped)
 * with no local counterpart yet — those need `checkout -b --track`.
 */
export function partitionBranchList(
  local: string[],
  remote: string[],
): { local: string[]; remoteOnly: string[] } {
  const localSet = new Set(local);
  const remoteOnly: string[] = [];
  const seen = new Set<string>();
  for (const ref of remote) {
    const name = stripRemotePrefix(ref);
    if (!name || localSet.has(name) || seen.has(name)) continue;
    seen.add(name);
    remoteOnly.push(name);
  }
  return { local, remoteOnly };
}

async function listRemoteRefs(cwd: string): Promise<string[]> {
  const repoRoot = await getRepoRoot(cwd);
  const out = await git(repoRoot, [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname:short)",
    "refs/remotes",
  ]);
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const line of out.split("\n")) {
    const name = line.trim();
    if (!name || name.endsWith("/HEAD") || seen.has(name)) continue;
    seen.add(name);
    refs.push(name);
  }
  return refs;
}

/** Remote-tracking branches ("<remote>/<branch>") for the switcher UI (capped). */
export async function listRemoteBranches(cwd: string, limit = 40): Promise<string[]> {
  const refs = await listRemoteRefs(cwd);
  return refs.slice(0, limit);
}

/**
 * Check out `branch` in the cwd's checkout. Local branches switch directly;
 * a branch that only exists on exactly one remote gets a local tracking
 * branch (`checkout -b --track`). Surfaces git's own errors (e.g. the branch
 * is checked out in another worktree, or uncommitted changes conflict).
 */
export async function switchBranch(cwd: string, branch: string): Promise<{ branch: string }> {
  const trimmed = branch.trim();
  // Branch names are passed as argv to git — never let one start with "-"
  // ("--upload-pack=…" would be parsed as an option, not a ref).
  if (!trimmed || trimmed.startsWith("-")) {
    throw new Error("Invalid branch name");
  }

  try {
    const repoRoot = await getRepoRoot(cwd);
    let branchExists = false;
    try {
      await git(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${trimmed}`]);
      branchExists = true;
    } catch {
      branchExists = false;
    }

    if (branchExists) {
      await git(cwd, ["checkout", trimmed]);
    } else {
      const matches = matchRemoteRefs(await listRemoteRefs(repoRoot), trimmed);
      if (matches.length === 0) throw new Error(`Branch not found: ${trimmed}`);
      if (matches.length > 1) {
        throw new Error(`Branch exists on multiple remotes: ${matches.join(", ")}`);
      }
      await git(cwd, ["checkout", "-b", trimmed, "--track", matches[0]]);
    }
  } catch (error) {
    // extractGitError passes through plain Error messages (no stderr), so the
    // "not found" / "ambiguous" errors above surface unchanged.
    throw new Error(extractGitError(error));
  }

  invalidateProjectCache();
  return { branch: trimmed };
}

/** `git fetch --prune` so newly pushed branches show up in the switcher. */
export async function fetchRemote(cwd: string): Promise<void> {
  const repoRoot = await getRepoRoot(cwd);
  try {
    await git(repoRoot, ["fetch", "--prune"], 90_000);
  } catch (error) {
    throw new Error(extractGitError(error));
  }
}

export async function addWorktree(cwd: string, branch: string): Promise<{ path: string; branch: string }> {
  const trimmed = branch.trim();
  if (!trimmed) throw new Error("Branch name is required");

  const dirName = sanitizeBranchForDir(trimmed);
  if (!dirName) throw new Error(`Invalid branch name: ${branch}`);

  const repoRoot = await getRepoRoot(cwd);
  const baseDir = `${resolve(repoRoot)}-worktrees`;
  const worktreePath = join(baseDir, dirName);
  if (existsSync(worktreePath)) {
    throw new Error(`Directory already exists: ${worktreePath}`);
  }
  mkdirSync(baseDir, { recursive: true });

  // Reuse the branch if it already exists, otherwise create it at HEAD.
  let branchExists = false;
  try {
    await git(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${trimmed}`]);
    branchExists = true;
  } catch {
    branchExists = false;
  }

  try {
    if (branchExists) {
      await git(repoRoot, ["worktree", "add", "--", worktreePath, trimmed]);
    } else {
      await git(repoRoot, ["worktree", "add", "-b", trimmed, "--", worktreePath]);
    }
  } catch (error) {
    throw new Error(extractGitError(error));
  }

  allowFileRoot(worktreePath);
  invalidateProjectCache();
  return { path: worktreePath, branch: trimmed };
}

export async function removeWorktree(cwd: string, worktreePath: string, force = false): Promise<void> {
  const worktrees = await listWorktrees(cwd);
  const target = worktrees.find((w) => w.path === worktreePath);
  if (!target) throw new Error(`Not a worktree of this repository: ${worktreePath}`);
  if (target.isMain) throw new Error("Cannot remove the main worktree");

  try {
    await git(cwd, ["worktree", "remove", ...(force ? ["--force"] : []), worktreePath]);
  } catch (error) {
    throw new Error(extractGitError(error));
  }
  invalidateProjectCache();
}

function extractGitError(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}
