"use strict";

const expectedParentPid = Number.parseInt(process.env.PI_WEB_PARENT_PID ?? "", 10);

// A normal App quit is handled by the Rust shell. This small watchdog also
// prevents the local server from becoming orphaned if the GUI process crashes
// or is force-terminated by macOS.
const parentWatchdog = setInterval(() => {
  if (!Number.isInteger(expectedParentPid) || process.ppid === 1) {
    process.exit(0);
  }

  try {
    process.kill(expectedParentPid, 0);
  } catch {
    process.exit(0);
  }
}, 1_000);
parentWatchdog.unref();

// The standalone Next.js entrypoint is CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("./server.js");
