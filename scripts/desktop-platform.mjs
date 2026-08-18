/**
 * Resolves the Rust target triple used by the desktop packaging scripts.
 * @param {NodeJS.Platform} platform Node.js platform name for the build host.
 * @param {string} arch Node.js CPU architecture name for the build host.
 * @returns {string} Rust target triple that matches the native packaged resources.
 */
export function desktopTargetTriple(
  platform = process.platform,
  arch = process.arch,
) {
  if (platform === "darwin" && arch === "arm64") {
    return "aarch64-apple-darwin";
  }
  if (platform === "linux" && arch === "x64") {
    return "x86_64-unknown-linux-gnu";
  }
  if (platform === "linux" && arch === "arm64") {
    return "aarch64-unknown-linux-gnu";
  }
  if (platform === "win32" && arch === "x64") {
    return "x86_64-pc-windows-msvc";
  }

  throw new Error(`Unsupported desktop platform: ${platform}/${arch}`);
}
