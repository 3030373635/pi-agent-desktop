"use strict";

/* eslint-disable @typescript-eslint/no-require-imports --
 * This launcher is installed as a standalone CommonJS entry point outside any
 * package.json module scope, so static require() keeps startup deterministic.
 */
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { constants } = require("node:fs");
const fileSystem = require("node:fs/promises");
const { createServer } = require("node:net");
const { homedir, tmpdir } = require("node:os");
const { dirname, join } = require("node:path");

const DEFAULT_PORT = 38471;
const MAX_PORT_OFFSET = 32;
const START_TIMEOUT_MS = 30_000;
const SUPPORTED_COMMANDS = new Set(["open", "status", "stop", "logs", "serve"]);

/**
 * Waits without blocking the Node.js event loop.
 * @param {number} milliseconds Number of milliseconds to wait.
 * @returns {Promise<void>} Promise resolved after the delay.
 */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Creates a Kylin launcher with injectable operating-system boundaries.
 * @param {object} dependencies Filesystem, process, network, and output dependencies.
 * @returns {{ paths: () => object, run: (argv: string[]) => Promise<number> }} Launcher operations.
 */
function createKylinLauncher(dependencies = {}) {
  const environment = dependencies.environment ?? process.env;
  const uid = dependencies.uid ?? (() => process.getuid?.() ?? process.pid);
  const processPid = dependencies.processPid ?? process.pid;
  const installRoot = dependencies.installRoot ?? dirname(__dirname);
  const nodePath = join(installRoot, "resources", "node", "node");
  const launcherPath = join(installRoot, "launcher", "pi-agent-kylin.cjs");
  const serverDirectory = join(installRoot, "resources", "server");
  const serverScriptPath = join(serverDirectory, "desktop-server.cjs");
  const print = dependencies.print ?? ((value) => console.log(value));
  const printError = dependencies.printError ?? ((value) => console.error(value));
  const wait = dependencies.wait ?? delay;
  const now = dependencies.now ?? Date.now;
  const processEvents = dependencies.processEvents ?? process;

  /**
   * Resolves private runtime and persistent log paths for the current user.
   * @returns {{ runtimeDir: string, statePath: string, lockPath: string, logPath: string }} Paths.
   */
  function paths() {
    const runtimeBase = environment.XDG_RUNTIME_DIR
      || join(tmpdir(), `pi-agent-${uid()}`);
    const stateBase = environment.XDG_STATE_HOME
      || join(environment.HOME || homedir(), ".local", "state");
    const runtimeDir = join(runtimeBase, "pi-agent");

    return {
      runtimeDir,
      statePath: join(runtimeDir, "server.json"),
      lockPath: join(runtimeDir, "launch.lock"),
      logPath: join(stateBase, "pi-agent", "server.log"),
    };
  }

  /**
   * Creates the runtime and log directories with user-only permissions.
   * @returns {Promise<void>} Promise resolved after both directories exist.
   */
  async function defaultEnsureDirectories() {
    const resolved = paths();
    await fileSystem.mkdir(resolved.runtimeDir, { recursive: true, mode: 0o700 });
    await fileSystem.mkdir(dirname(resolved.logPath), { recursive: true, mode: 0o700 });
    await fileSystem.chmod(resolved.runtimeDir, 0o700);
    await fileSystem.chmod(dirname(resolved.logPath), 0o700);
  }

  const ensureDirectories = dependencies.ensureDirectories ?? defaultEnsureDirectories;

  /**
   * Verifies that the bundled Node.js and server entry point are executable/readable.
   * @returns {Promise<void>} Promise resolved when both packaged files exist.
   */
  async function defaultValidateResources() {
    await Promise.all([
      fileSystem.access(nodePath, constants.X_OK),
      fileSystem.access(serverScriptPath, constants.R_OK),
    ]);
  }

  const validateResources = dependencies.validateResources ?? defaultValidateResources;

  /**
   * Validates a decoded server state object before using any PID from it.
   * @param {unknown} value Parsed JSON value.
   * @returns {value is { supervisorPid: number, port: number, instanceId: string, phase?: string, startedAt?: number }} Validation result.
   */
  function isStateRecord(value) {
    const hasValidBase = Boolean(
      value
      && typeof value === "object"
      && Number.isInteger(value.supervisorPid)
      && value.supervisorPid > 1
      && Number.isInteger(value.port)
      && typeof value.instanceId === "string"
      && value.instanceId.length >= 4,
    );
    if (!hasValidBase) return false;

    if (value.phase === "starting") {
      return value.port === 0
        && Number.isFinite(value.startedAt)
        && value.startedAt > 0;
    }
    return Boolean(
      value.port > 0
      && value.port <= 65_535
      && (value.phase === undefined || value.phase === "running"),
    );
  }

  /**
   * Reads and validates the per-user server state file.
   * @returns {Promise<object|null>} Valid state record, or null when absent or malformed.
   */
  async function defaultReadState() {
    try {
      const value = JSON.parse(await fileSystem.readFile(paths().statePath, "utf8"));
      return isStateRecord(value) ? value : null;
    } catch {
      return null;
    }
  }

  const readState = dependencies.readState ?? defaultReadState;

  /**
   * Atomically writes a user-private server state record.
   * @param {{ supervisorPid: number, port: number, instanceId: string, phase?: string, startedAt?: number }} state State to persist.
   * @returns {Promise<void>} Promise resolved after the state is replaced.
   */
  async function defaultWriteState(state) {
    const statePath = paths().statePath;
    const temporaryPath = `${statePath}.${processPid}.tmp`;
    await fileSystem.writeFile(temporaryPath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    // Rename keeps readers from observing a partially written JSON document.
    await fileSystem.rename(temporaryPath, statePath);
  }

  const writeState = dependencies.writeState ?? defaultWriteState;

  /**
   * Removes the state file without failing when it is already absent.
   * @returns {Promise<void>} Promise resolved after cleanup.
   */
  async function defaultRemoveState() {
    await fileSystem.rm(paths().statePath, { force: true });
  }

  const removeState = dependencies.removeState ?? defaultRemoveState;

  /**
   * Removes state only if every supplied ownership field still matches.
   * @param {{ instanceId: string, supervisorPid?: number, port?: number, phase?: string, startedAt?: number }} expectedState State fields observed by the caller.
   * @returns {Promise<void>} Promise resolved after conditional cleanup.
   */
  async function defaultRemoveStateIfOwned(expectedState) {
    await withLaunchLock(async () => {
      const current = await readState();
      const matches = current?.instanceId === expectedState.instanceId
        && ["supervisorPid", "port", "phase", "startedAt"].every((field) => (
          !Object.hasOwn(expectedState, field) || current[field] === expectedState[field]
        ));
      // Comparison and deletion share the writer lock and reject phase transitions.
      if (matches) await removeState();
    });
  }

  const removeStateIfOwned = dependencies.removeStateIfOwned ?? defaultRemoveStateIfOwned;

  /**
   * Checks whether a process identifier currently exists.
   * @param {number} pid Process identifier to probe.
   * @returns {boolean} True only when the operating system still knows the PID.
   */
  function defaultProcessExists(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  const processExists = dependencies.processExists ?? defaultProcessExists;

  /**
   * Probes the packaged identity endpoint for an exact instance match.
   * @param {{ port: number, instanceId: string }} state State describing the expected server.
   * @returns {Promise<boolean>} True when the expected packaged server responds.
   */
  async function defaultProbeIdentity(state) {
    try {
      const response = await fetch(`http://127.0.0.1:${state.port}/api/desktop/identity`, {
        signal: AbortSignal.timeout(750),
      });
      return response.status === 204
        && response.headers.get("x-pi-desktop-instance") === state.instanceId;
    } catch {
      return false;
    }
  }

  const probeIdentity = dependencies.probeIdentity ?? defaultProbeIdentity;

  /**
   * Requires both PID existence and HTTP identity before trusting state.
   * @param {object|null} state Candidate server state.
   * @returns {Promise<boolean>} True only for the live recorded Pi Agent instance.
   */
  async function isHealthy(state) {
    return Boolean(
      state
      && state.phase !== "starting"
      && state.port > 0
      && processExists(state.supervisorPid)
      && await probeIdentity(state),
    );
  }

  /**
   * Identifies a time-bounded startup reservation that another launcher must preserve.
   * @param {object|null} state Candidate server state.
   * @returns {boolean} True while the matching supervisor is still allowed to start.
   */
  function isRecentStartup(state) {
    return Boolean(
      state?.phase === "starting"
      && now() - state.startedAt < START_TIMEOUT_MS,
    );
  }

  /**
   * Serializes startup operations with a short-lived per-user lock file.
   * @param {() => Promise<unknown>} operation Startup operation to run exclusively.
   * @returns {Promise<unknown>} Operation result.
   */
  async function defaultWithLaunchLock(operation) {
    await ensureDirectories();
    const lockPath = paths().lockPath;
    const deadline = Date.now() + START_TIMEOUT_MS;

    while (Date.now() < deadline) {
      let handle;
      try {
        handle = await fileSystem.open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
        await handle.writeFile(`${processPid}\n`);
        try {
          return await operation();
        } finally {
          await handle.close();
          await fileSystem.rm(lockPath, { force: true });
        }
      } catch (error) {
        if (handle) await handle.close().catch(() => {});
        if (error?.code !== "EEXIST") throw error;

        const owner = Number.parseInt(await fileSystem.readFile(lockPath, "utf8").catch(() => ""), 10);
        if (!Number.isInteger(owner) || !processExists(owner)) {
          await fileSystem.rm(lockPath, { force: true });
          continue;
        }
        await wait(50);
      }
    }

    throw new Error(`Timed out waiting for Pi Agent launch lock: ${lockPath}`);
  }

  const withLaunchLock = dependencies.withLaunchLock ?? defaultWithLaunchLock;

  /**
   * Starts a command and rejects when it cannot be executed successfully.
   * @param {string} command Executable name.
   * @param {string[]} args Command arguments.
   * @returns {Promise<void>} Promise resolved for exit code zero.
   */
  async function defaultOpenCommand(command, args) {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: "ignore" });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
      });
    });
  }

  const openCommand = dependencies.openCommand ?? defaultOpenCommand;

  /**
   * Opens a loopback URL with available desktop helpers.
   * @param {string} url Loopback application URL.
   * @returns {Promise<void>} Promise resolved even when manual opening is required.
   */
  async function openBrowser(url) {
    for (const [command, args] of [["xdg-open", [url]], ["gio", ["open", url]]]) {
      try {
        await openCommand(command, args);
        return;
      } catch {
        // Continue to the next portable desktop opener.
      }
    }
    print(`Pi Agent is running at ${url}. Open this address in a browser.`);
  }

  /**
   * Starts the detached supervisor with the packaged Node.js runtime.
   * @param {string} instanceId Startup reservation identifier to claim.
   * @returns {number} Detached supervisor process identifier.
   */
  function defaultSpawnSupervisor(instanceId) {
    const child = spawn(nodePath, [launcherPath, "serve"], {
      cwd: installRoot,
      detached: true,
      env: { ...environment, PI_KYLIN_INSTANCE_ID: instanceId },
      stdio: "ignore",
    });
    child.unref();
    if (!child.pid) throw new Error("Pi Agent supervisor did not return a process id.");
    return child.pid;
  }

  const spawnSupervisor = dependencies.spawnSupervisor ?? defaultSpawnSupervisor;

  /**
   * Waits for a newly spawned supervisor to publish a healthy state record.
   * @param {string} expectedInstanceId Startup reservation identifier to wait for.
   * @returns {Promise<object>} Healthy state.
   */
  async function defaultWaitForHealthyState(expectedInstanceId) {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const state = await readState();
      if (state?.instanceId === expectedInstanceId && await isHealthy(state)) return state;
      await wait(100);
    }
    throw new Error(`Pi Agent server did not start; see ${paths().logPath}`);
  }

  const waitForHealthyState = dependencies.waitForHealthyState ?? defaultWaitForHealthyState;

  /**
   * Waits for the child server identity before publishing running state.
   * @param {{ port: number, instanceId: string }} state Expected child server identity.
   * @returns {Promise<void>} Promise resolved only after the identity endpoint matches.
   */
  async function defaultWaitForServerIdentity(state) {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await probeIdentity(state)) return;
      await wait(100);
    }
    throw new Error(`Pi Agent server identity did not become ready; see ${paths().logPath}`);
  }

  const waitForServerIdentity = dependencies.waitForServerIdentity
    ?? defaultWaitForServerIdentity;

  /**
   * Tries to bind a loopback port and releases it immediately.
   * @param {number} port Port to probe, or zero for an operating-system selection.
   * @returns {Promise<number|null>} Available port, or null when occupied.
   */
  async function probePort(port) {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.unref();
      server.once("error", (error) => {
        if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve(null);
        else reject(error);
      });
      server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
        const address = server.address();
        const selectedPort = typeof address === "object" && address ? address.port : null;
        server.close((error) => error ? reject(error) : resolve(selectedPort));
      });
    });
  }

  /**
   * Chooses a bounded stable loopback port with an ephemeral fallback.
   * @returns {Promise<number>} Available loopback port.
   */
  async function defaultChoosePort() {
    for (let offset = 0; offset <= MAX_PORT_OFFSET; offset += 1) {
      const selected = await probePort(DEFAULT_PORT + offset);
      if (selected) return selected;
    }
    const selected = await probePort(0);
    if (!selected) throw new Error("Could not allocate a loopback port for Pi Agent.");
    return selected;
  }

  const choosePort = dependencies.choosePort ?? defaultChoosePort;
  const randomId = dependencies.randomId ?? (() => randomBytes(32).toString("hex"));

  /**
   * Starts and controls the packaged Next.js server process group.
   * @param {object} options Script path, working directory, environment, and log path.
   * @returns {Promise<{ wait: () => Promise<number>, terminate: () => Promise<void> }>} Server handle.
   */
  async function defaultSpawnServer(options) {
    const logHandle = await fileSystem.open(options.logPath, "a", 0o600);
    const child = spawn(nodePath, [options.scriptPath], {
      cwd: options.currentDirectory,
      detached: true,
      env: options.environment,
      stdio: ["ignore", logHandle.fd, logHandle.fd],
    });
    const exitPromise = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    }).finally(() => logHandle.close().catch(() => {}));

    /** Terminates the whole server process group, escalating after two seconds. */
    async function terminate() {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        return;
      }
      const exited = await Promise.race([
        exitPromise.then(() => true),
        wait(2_000).then(() => false),
      ]);
      if (!exited) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The process exited between the timeout and escalation.
        }
      }
    }

    return { wait: () => exitPromise, terminate };
  }

  const spawnServer = dependencies.spawnServer ?? defaultSpawnServer;
  const signalProcess = dependencies.signalProcess ?? ((pid, signal) => process.kill(pid, signal));

  /**
   * Waits until a supervisor no longer owns a healthy identity endpoint.
   * @param {object} state State that was signalled.
   * @returns {Promise<boolean>} True when shutdown completes before timeout.
   */
  async function defaultWaitUntilStopped(state) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (!processExists(state.supervisorPid) || !await probeIdentity(state)) return true;
      await wait(100);
    }
    return false;
  }

  const waitUntilStopped = dependencies.waitUntilStopped ?? defaultWaitUntilStopped;

  /**
   * Opens an existing healthy instance or starts exactly one supervisor.
   * @returns {Promise<number>} Exit code.
   */
  async function openApplication() {
    let state;
    let expectedInstanceId;

    await withLaunchLock(async () => {
      state = await readState();
      if (await isHealthy(state)) return;

      if (isRecentStartup(state)) {
        expectedInstanceId = state.instanceId;
        state = null;
        return;
      }

      if (state) await removeState();
      expectedInstanceId = randomId();
      state = null;
      const reservation = {
        supervisorPid: processPid,
        port: 0,
        instanceId: expectedInstanceId,
        phase: "starting",
        startedAt: now(),
      };
      // Publish a reservation before spawning so a replacement launcher waits after parent death.
      await writeState(reservation);
      try {
        const supervisorPid = spawnSupervisor(expectedInstanceId);
        await writeState({ ...reservation, supervisorPid });
      } catch (error) {
        await removeState();
        throw error;
      }
    });

    if (!state) state = await waitForHealthyState(expectedInstanceId);
    await openBrowser(`http://127.0.0.1:${state.port}`);
    return 0;
  }

  /**
   * Reports whether a verified packaged server is running.
   * @returns {Promise<number>} Zero for running, one for stopped.
   */
  async function reportStatus() {
    const state = await readState();
    if (!await isHealthy(state)) {
      if (isRecentStartup(state)) {
        printError("Pi Agent is starting.");
        return 1;
      }
      if (state) await removeStateIfOwned(state);
      printError("Pi Agent is not running.");
      return 1;
    }
    print(`Pi Agent is running at http://127.0.0.1:${state.port}`);
    return 0;
  }

  /**
   * Stops only the supervisor verified by both PID and instance identity.
   * @returns {Promise<number>} Zero for stopped or already stopped.
   */
  async function stopApplication() {
    const state = await readState();
    if (!await isHealthy(state)) {
      if (state) await removeStateIfOwned(state);
      print("Pi Agent is already stopped.");
      return 0;
    }

    signalProcess(state.supervisorPid, "SIGTERM");
    if (!await waitUntilStopped(state)) {
      printError(`Pi Agent did not stop; see ${paths().logPath}`);
      return 1;
    }
    await removeStateIfOwned(state);
    print("Pi Agent stopped.");
    return 0;
  }

  /**
   * Supervises the packaged Next.js server until it exits or receives a signal.
   * @returns {Promise<number>} Server exit code.
   */
  async function serve() {
    await ensureDirectories();
    await validateResources();

    const port = await choosePort();
    const reservationId = environment.PI_KYLIN_INSTANCE_ID?.trim();
    const instanceId = reservationId || randomId();
    const state = {
      supervisorPid: processPid,
      port,
      instanceId,
      phase: "running",
    };
    const serverEnvironment = {
      ...environment,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      PI_WEB_PARENT_PID: String(processPid),
      PI_DESKTOP_INSTANCE_ID: instanceId,
      // Bundled Node comes first so Pi subprocesses resolve packaged tools consistently.
      PATH: `${dirname(nodePath)}:${environment.PATH ?? ""}`,
    };
    // Browser mode must never inherit a Tauri filesystem authorization token.
    delete serverEnvironment.PI_DESKTOP_API_TOKEN;
    delete serverEnvironment.PI_KYLIN_INSTANCE_ID;

    const server = await spawnServer({
      currentDirectory: serverDirectory,
      environment: serverEnvironment,
      logPath: paths().logPath,
      scriptPath: serverScriptPath,
    });
    let claimed = false;
    let stopping = false;
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      server.terminate().catch((error) => printError(error.message));
    };
    processEvents.once("SIGINT", shutdown);
    processEvents.once("SIGTERM", shutdown);

    try {
      // Keep the shared state in the starting phase until this exact child responds.
      await Promise.race([
        waitForServerIdentity(state),
        server.wait().then((code) => {
          throw new Error(`Pi Agent server exited before startup completed (exit ${code}).`);
        }),
      ]);
      claimed = await withLaunchLock(async () => {
        const current = await readState();
        if (reservationId) {
          if (current?.phase !== "starting" || current.instanceId !== reservationId) return false;
        } else if (current) {
          return false;
        }
        await writeState(state);
        return true;
      });
      if (!claimed) return 1;
      return await server.wait();
    } finally {
      processEvents.removeListener("SIGINT", shutdown);
      processEvents.removeListener("SIGTERM", shutdown);
      if (!claimed) await server.terminate();
      await removeStateIfOwned(
        claimed ? state : { instanceId, phase: "starting" },
      );
    }
  }

  /**
   * Executes a documented public or internal launcher command.
   * @param {string[]} argv Command arguments excluding Node and script paths.
   * @returns {Promise<number>} Process exit code.
   */
  async function run(argv) {
    const command = argv[0] ?? "open";
    if (!SUPPORTED_COMMANDS.has(command)) {
      printError("Usage: pi-agent-desktop [open|status|stop|logs]");
      return 2;
    }

    if (command === "open") return openApplication();
    if (command === "status") return reportStatus();
    if (command === "stop") return stopApplication();
    if (command === "logs") {
      print(paths().logPath);
      return 0;
    }
    return serve();
  }

  return { paths, run };
}

/**
 * Runs the command-line launcher using the current process environment.
 * @param {string[]} argv Command arguments excluding Node and script paths.
 * @param {NodeJS.ProcessEnv} environment Environment passed to the launcher.
 * @returns {Promise<number>} Process exit code.
 */
async function runKylinLauncher(
  argv = process.argv.slice(2),
  environment = process.env,
) {
  return createKylinLauncher({ environment }).run(argv);
}

if (require.main === module) {
  runKylinLauncher().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}

module.exports = { createKylinLauncher, runKylinLauncher };
