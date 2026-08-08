import {
  getFileDirectory,
  getFileName,
  getRelativeFilePath,
  joinFilePath,
  normalizeFilePathSlashes,
} from "./file-paths";

/** Prefer an explicit drop target, else the selected folder (or parent of a selected file), else cwd. */
export function resolveExplorerUploadDirectory(options: {
  cwd: string;
  selectedPath: string | null;
  selectedIsDir: boolean;
  overridePath?: string | null;
}): string {
  if (options.overridePath) return options.overridePath;
  if (options.selectedPath) {
    return options.selectedIsDir ? options.selectedPath : getFileDirectory(options.selectedPath);
  }
  return options.cwd;
}

export function uploadDestinationLabel(targetDirectory: string, cwd: string): string {
  const normalizedTarget = normalizeFilePathSlashes(targetDirectory).replace(/\/$/, "");
  const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
  if (normalizedTarget === normalizedCwd) return getFileName(cwd) || cwd;
  return getRelativeFilePath(targetDirectory, cwd) || getFileName(targetDirectory);
}

export function collectAncestorDirectories(targetDirectory: string, cwd: string): string[] {
  const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
  const relative = getRelativeFilePath(targetDirectory, cwd);
  if (!relative || relative === targetDirectory) {
    const normalizedTarget = normalizeFilePathSlashes(targetDirectory).replace(/\/$/, "");
    return normalizedTarget === normalizedCwd ? [] : [targetDirectory];
  }
  const parts = relative.split("/").filter(Boolean);
  const directories: string[] = [];
  let current = cwd;
  for (const part of parts) {
    current = joinFilePath(current, part);
    directories.push(current);
  }
  return directories;
}
