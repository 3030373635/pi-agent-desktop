import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import appPackage from "../package.json";
import type { AppUpdateInfo, AppUpdateProjectId } from "@/lib/api-types";
import { PRODUCT_NAME } from "./branding";

export const APP_UPDATE_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const APP_UPDATE_RETRY_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface AppUpdateProject {
  id: AppUpdateProjectId;
  name: string;
  repository: `${string}/${string}`;
  currentVersion: string;
}

interface GitHubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

interface ParsedVersion {
  display: string;
  core: [number, number, number];
  prerelease: string[];
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export const APP_UPDATE_PROJECTS: readonly AppUpdateProject[] = [
  {
    id: "pi",
    name: `${PRODUCT_NAME} Core`,
    repository: "earendil-works/pi",
    currentVersion: PI_VERSION,
  },
  {
    id: "pi-web",
    name: `${PRODUCT_NAME} App`,
    repository: "agegr/pi-web",
    currentVersion: appPackage.version,
  },
];

function parseVersion(value: string): ParsedVersion | null {
  const display = value.trim().replace(/^v/i, "");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(display);
  if (!match) return null;

  return {
    display,
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;

    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) return Number(left) < Number(right) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left < right ? -1 : 1;
  }

  return 0;
}

export function compareAppVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`Invalid version comparison: ${left} / ${right}`);

  for (let index = 0; index < a.core.length; index++) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

export function isAppUpdateDue(lastCheckedAt: number | undefined, now: number): boolean {
  return !Number.isFinite(lastCheckedAt)
    || now - (lastCheckedAt as number) >= APP_UPDATE_CHECK_INTERVAL_MS
    || now < (lastCheckedAt as number);
}

export function getNextAppUpdateCheckAt(
  lastCheckedAt: Partial<Record<AppUpdateProjectId, number>>,
  now: number,
): number {
  return Math.min(...APP_UPDATE_PROJECTS.map((project) => {
    const checkedAt = lastCheckedAt[project.id];
    return Number.isFinite(checkedAt)
      ? Math.max(now, (checkedAt as number) + APP_UPDATE_CHECK_INTERVAL_MS)
      : now;
  }));
}

function parseRelease(project: AppUpdateProject, raw: GitHubRelease): AppUpdateInfo | null {
  if (raw.draft === true || raw.prerelease === true) return null;
  if (typeof raw.tag_name !== "string" || typeof raw.html_url !== "string") {
    throw new Error("GitHub returned an invalid release payload.");
  }

  const latest = parseVersion(raw.tag_name);
  const current = parseVersion(project.currentVersion);
  if (!latest || !current) throw new Error("GitHub returned an invalid release version.");

  const releaseUrl = new URL(raw.html_url);
  if (releaseUrl.protocol !== "https:" || releaseUrl.hostname !== "github.com") {
    throw new Error("GitHub returned an invalid release URL.");
  }
  if (compareAppVersions(latest.display, current.display) <= 0) return null;

  return {
    project: project.id,
    name: project.name,
    currentVersion: current.display,
    latestVersion: latest.display,
    releaseUrl: releaseUrl.toString(),
  };
}

export async function checkAppUpdate(
  project: AppUpdateProject,
  options: { fetcher?: Fetcher; timeoutMs?: number } = {},
): Promise<AppUpdateInfo | null> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(
    `https://api.github.com/repos/${project.repository}/releases/latest`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": `pi-web/${appPackage.version}`,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    },
  );
  if (!response.ok) throw new Error(`GitHub request failed with HTTP ${response.status}.`);
  return parseRelease(project, await response.json() as GitHubRelease);
}
