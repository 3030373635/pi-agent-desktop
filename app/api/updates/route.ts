import { randomUUID } from "crypto";
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  APP_UPDATE_PROJECTS,
  APP_UPDATE_RETRY_INTERVAL_MS,
  checkAppUpdate,
  getNextAppUpdateCheckAt,
  isAppUpdateDue,
} from "@/lib/app-updates";
import type {
  AppUpdateInfo,
  AppUpdateProjectId,
  AppUpdatesResponse,
} from "@/lib/api-types";

export const dynamic = "force-dynamic";

const STATE_VERSION = 1;
const STATE_FILE = "pi-web-update-check.json";

interface UpdateCheckState {
  version: number;
  lastCheckedAt: Partial<Record<AppUpdateProjectId, number>>;
}

declare global {
  var __piWebAppUpdateCheck: Promise<AppUpdatesResponse> | undefined;
}

function statePath(): string {
  return join(getAgentDir(), STATE_FILE);
}

function emptyState(): UpdateCheckState {
  return { version: STATE_VERSION, lastCheckedAt: {} };
}

async function readState(): Promise<UpdateCheckState> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), "utf8")) as {
      version?: unknown;
      lastCheckedAt?: unknown;
    };
    if (parsed.version !== STATE_VERSION || !parsed.lastCheckedAt || typeof parsed.lastCheckedAt !== "object") {
      return emptyState();
    }

    const raw = parsed.lastCheckedAt as Record<string, unknown>;
    const lastCheckedAt: UpdateCheckState["lastCheckedAt"] = {};
    for (const project of APP_UPDATE_PROJECTS) {
      const value = raw[project.id];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        lastCheckedAt[project.id] = value;
      }
    }
    return { version: STATE_VERSION, lastCheckedAt };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    return emptyState();
  }
}

async function writeState(state: UpdateCheckState): Promise<void> {
  const file = statePath();
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(file), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function performUpdateCheck(): Promise<AppUpdatesResponse> {
  const now = Date.now();
  const state = await readState();
  const dueProjects = APP_UPDATE_PROJECTS.filter((project) => (
    isAppUpdateDue(state.lastCheckedAt[project.id], now)
  ));

  const settled = await Promise.allSettled(dueProjects.map(async (project) => ({
    project,
    update: await checkAppUpdate(project),
  })));
  const updates: AppUpdateInfo[] = [];
  const errors: NonNullable<AppUpdatesResponse["errors"]> = [];
  let stateChanged = false;

  for (let index = 0; index < settled.length; index++) {
    const result = settled[index];
    const project = dueProjects[index];
    if (result.status === "fulfilled") {
      state.lastCheckedAt[project.id] = now;
      stateChanged = true;
      if (result.value.update) updates.push(result.value.update);
    } else {
      errors.push({
        project: project.id,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }

  if (stateChanged) await writeState(state);
  const nextCheck = errors.length > 0
    ? now + APP_UPDATE_RETRY_INTERVAL_MS
    : getNextAppUpdateCheckAt(state.lastCheckedAt, now);

  return {
    checkedAt: new Date(now).toISOString(),
    nextCheckAt: new Date(nextCheck).toISOString(),
    updates,
    ...(errors.length > 0 && { errors }),
  };
}

export async function GET() {
  if (!globalThis.__piWebAppUpdateCheck) {
    globalThis.__piWebAppUpdateCheck = performUpdateCheck()
      .finally(() => {
        globalThis.__piWebAppUpdateCheck = undefined;
      });
  }

  try {
    return Response.json(await globalThis.__piWebAppUpdateCheck);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
