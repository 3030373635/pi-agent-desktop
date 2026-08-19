import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createKylinLauncher } = require("../desktop/kylin-launcher.cjs");

test("uses XDG directories and produces user-private Pi Agent paths", () => {
  const launcher = createKylinLauncher({
    environment: {
      XDG_RUNTIME_DIR: "/run/user/1000",
      XDG_STATE_HOME: "/home/user/.state",
      HOME: "/home/user",
    },
    uid: () => 1000,
  });

  assert.deepEqual(launcher.paths(), {
    runtimeDir: "/run/user/1000/pi-agent",
    statePath: "/run/user/1000/pi-agent/server.json",
    lockPath: "/run/user/1000/pi-agent/launch.lock",
    logPath: "/home/user/.state/pi-agent/server.log",
  });
});

test("serve restricts existing runtime and log directories to the current user", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-agent-kylin-permissions-"));
  const runtimeBase = join(temporaryDirectory, "runtime");
  const stateBase = join(temporaryDirectory, "state");
  const logDirectory = join(stateBase, "pi-agent");

  try {
    await mkdir(runtimeBase, { recursive: true, mode: 0o777 });
    await mkdir(logDirectory, { recursive: true, mode: 0o777 });
    await chmod(runtimeBase, 0o777);
    await chmod(logDirectory, 0o777);

    const launcher = createKylinLauncher({
      environment: {
        XDG_RUNTIME_DIR: runtimeBase,
        XDG_STATE_HOME: stateBase,
        PI_KYLIN_INSTANCE_ID: "permission-instance",
      },
      installRoot: "/opt/pi-agent",
      validateResources: async () => {},
      choosePort: async () => 38473,
      readState: async () => ({
        supervisorPid: 54,
        port: 0,
        instanceId: "permission-instance",
        phase: "starting",
        startedAt: 100,
      }),
      withLaunchLock: async (operation) => operation(),
      spawnServer: async () => ({ wait: async () => 0, terminate: async () => {} }),
      waitForServerIdentity: async () => {},
      writeState: async () => {},
      removeStateIfOwned: async () => {},
    });

    assert.equal(await launcher.run(["serve"]), 0);
    assert.equal((await stat(join(runtimeBase, "pi-agent"))).mode & 0o777, 0o700);
    assert.equal((await stat(logDirectory)).mode & 0o777, 0o700);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("rejects unknown commands without starting a server", async () => {
  const errors = [];
  const launcher = createKylinLauncher({
    printError: (value) => errors.push(value),
  });

  assert.equal(await launcher.run(["unknown"]), 2);
  assert.match(errors.join("\n"), /open\|status\|stop\|logs/);
});

test("open reuses a state record only when PID and identity both match", async () => {
  const events = [];
  const launcher = createKylinLauncher({
    readState: async () => ({ supervisorPid: 42, port: 38471, instanceId: "instance-a" }),
    processExists: () => true,
    probeIdentity: async () => true,
    spawnSupervisor: () => assert.fail("healthy state must be reused"),
    withLaunchLock: async (operation) => operation(),
    openCommand: async (command, args) => events.push([command, args]),
  });

  assert.equal(await launcher.run(["open"]), 0);
  assert.deepEqual(events, [["xdg-open", ["http://127.0.0.1:38471"]]]);
});

test("open removes stale state and starts one detached supervisor", async () => {
  const events = [];
  const freshState = {
    supervisorPid: 43,
    port: 38472,
    instanceId: "fresh",
    phase: "running",
  };
  const launcher = createKylinLauncher({
    processPid: 40,
    randomId: () => "fresh",
    now: () => 100,
    readState: async () => ({ supervisorPid: 41, port: 38471, instanceId: "stale" }),
    processExists: () => false,
    probeIdentity: async () => false,
    removeState: async () => events.push("remove"),
    writeState: async (state) => events.push(["write", state]),
    spawnSupervisor: (instanceId) => {
      events.push(`spawn:${instanceId}`);
      return 43;
    },
    waitForHealthyState: async (instanceId) => {
      assert.equal(instanceId, "fresh");
      return freshState;
    },
    withLaunchLock: async (operation) => {
      events.push("lock:start");
      const result = await operation();
      events.push("lock:end");
      return result;
    },
    openCommand: async (command, args) => events.push([command, args]),
  });

  assert.equal(await launcher.run(["open"]), 0);
  assert.deepEqual(events, [
    "lock:start",
    "remove",
    ["write", {
      supervisorPid: 40,
      port: 0,
      instanceId: "fresh",
      phase: "starting",
      startedAt: 100,
    }],
    "spawn:fresh",
    ["write", {
      supervisorPid: 43,
      port: 0,
      instanceId: "fresh",
      phase: "starting",
      startedAt: 100,
    }],
    "lock:end",
    ["xdg-open", ["http://127.0.0.1:38472"]],
  ]);
});

test("open waits for a recent startup reservation even when its creator exited", async () => {
  const startingState = {
    supervisorPid: 41,
    port: 0,
    instanceId: "starting-a",
    phase: "starting",
    startedAt: 100,
  };
  const launcher = createKylinLauncher({
    now: () => 200,
    readState: async () => startingState,
    processExists: () => false,
    probeIdentity: async () => false,
    removeState: async () => assert.fail("recent startup reservation must be preserved"),
    writeState: async () => assert.fail("existing startup reservation must be reused"),
    spawnSupervisor: () => assert.fail("existing startup reservation must not spawn twice"),
    waitForHealthyState: async (instanceId) => {
      assert.equal(instanceId, "starting-a");
      return { supervisorPid: 43, port: 38472, instanceId, phase: "running" };
    },
    withLaunchLock: async (operation) => operation(),
    openCommand: async () => {},
  });

  assert.equal(await launcher.run(["open"]), 0);
});

test("browser fallback tries xdg-open before gio and prints the URL when both fail", async () => {
  const commands = [];
  const output = [];
  const launcher = createKylinLauncher({
    readState: async () => ({ supervisorPid: 42, port: 38471, instanceId: "instance-a" }),
    processExists: () => true,
    probeIdentity: async () => true,
    withLaunchLock: async (operation) => operation(),
    openCommand: async (command) => {
      commands.push(command);
      throw new Error(`${command} unavailable`);
    },
    print: (value) => output.push(value),
  });

  assert.equal(await launcher.run(["open"]), 0);
  assert.deepEqual(commands, ["xdg-open", "gio"]);
  assert.match(output.join("\n"), /http:\/\/127\.0\.0\.1:38471/);
});

test("status returns nonzero unless PID and server identity are healthy", async () => {
  const state = { supervisorPid: 42, port: 38471, instanceId: "instance-a" };
  const events = [];
  const stale = createKylinLauncher({
    readState: async () => state,
    processExists: () => true,
    probeIdentity: async () => false,
    removeState: async () => events.push("remove"),
    withLaunchLock: async (operation) => {
      events.push("lock:start");
      const result = await operation();
      events.push("lock:end");
      return result;
    },
    printError: () => {},
  });
  const healthy = createKylinLauncher({
    readState: async () => state,
    processExists: () => true,
    probeIdentity: async () => true,
    print: () => {},
  });

  assert.equal(await stale.run(["status"]), 1);
  assert.deepEqual(events, ["lock:start", "remove", "lock:end"]);
  assert.equal(await healthy.run(["status"]), 0);
});

test("status preserves a recent startup reservation while identity is unavailable", async () => {
  const events = [];
  const launcher = createKylinLauncher({
    now: () => 200,
    readState: async () => ({
      supervisorPid: 42,
      port: 0,
      instanceId: "starting-status",
      phase: "starting",
      startedAt: 100,
    }),
    processExists: () => true,
    probeIdentity: async () => false,
    removeState: async () => events.push("remove"),
    withLaunchLock: async (operation) => operation(),
    printError: (value) => events.push(value),
  });

  assert.equal(await launcher.run(["status"]), 1);
  assert.deepEqual(events, ["Pi Agent is starting."]);
});

test("status cannot delete a startup reservation that became running before cleanup", async () => {
  let reads = 0;
  const events = [];
  const launcher = createKylinLauncher({
    now: () => 40_000,
    readState: async () => {
      reads += 1;
      if (reads === 1) {
        return {
          supervisorPid: 42,
          port: 0,
          instanceId: "transitioning-instance",
          phase: "starting",
          startedAt: 100,
        };
      }
      return {
        supervisorPid: 42,
        port: 38471,
        instanceId: "transitioning-instance",
        phase: "running",
      };
    },
    processExists: () => true,
    probeIdentity: async () => false,
    removeState: async () => events.push("remove"),
    withLaunchLock: async (operation) => operation(),
    printError: () => {},
  });

  assert.equal(await launcher.run(["status"]), 1);
  assert.deepEqual(events, []);
});

test("stop is idempotent and signals only the verified supervisor", async () => {
  const signals = [];
  const cleanupEvents = [];
  const state = { supervisorPid: 42, port: 38471, instanceId: "instance-a" };
  const launcher = createKylinLauncher({
    readState: async () => state,
    processExists: () => true,
    probeIdentity: async () => true,
    signalProcess: (pid, signal) => signals.push([pid, signal]),
    waitUntilStopped: async () => true,
    removeState: async () => cleanupEvents.push("remove"),
    withLaunchLock: async (operation) => {
      cleanupEvents.push("lock:start");
      const result = await operation();
      cleanupEvents.push("lock:end");
      return result;
    },
    print: () => {},
  });

  assert.equal(await launcher.run(["stop"]), 0);
  assert.deepEqual(signals, [[42, "SIGTERM"]]);
  assert.deepEqual(cleanupEvents, ["lock:start", "remove", "lock:end"]);
});

test("serve selects a loopback port and starts the existing desktop server", async () => {
  let serverOptions;
  let writtenState;
  const lifecycleEvents = [];
  const launcher = createKylinLauncher({
    environment: { PATH: "/usr/bin", PI_KYLIN_INSTANCE_ID: "instance-c" },
    installRoot: "/opt/pi-agent",
    ensureDirectories: async () => {},
    validateResources: async () => {},
    choosePort: async () => 38473,
    processPid: 55,
    readState: async () => ({
      supervisorPid: 54,
      port: 0,
      instanceId: "instance-c",
      phase: "starting",
      startedAt: 100,
    }),
    withLaunchLock: async (operation) => {
      lifecycleEvents.push("claim-lock");
      return operation();
    },
    spawnServer: (options) => {
      serverOptions = options;
      lifecycleEvents.push("spawn-server");
      return { wait: async () => 0, terminate: async () => {} };
    },
    waitForServerIdentity: async (state) => {
      assert.equal(state.instanceId, "instance-c");
      lifecycleEvents.push("identity-ready");
    },
    writeState: async (state) => {
      writtenState = state;
      lifecycleEvents.push("write-running");
    },
    removeStateIfOwned: async () => {},
  });

  assert.equal(await launcher.run(["serve"]), 0);
  assert.deepEqual(lifecycleEvents, [
    "spawn-server",
    "identity-ready",
    "claim-lock",
    "write-running",
  ]);
  assert.deepEqual(writtenState, {
    supervisorPid: 55,
    port: 38473,
    instanceId: "instance-c",
    phase: "running",
  });
  assert.equal(serverOptions.environment.HOSTNAME, "127.0.0.1");
  assert.equal(serverOptions.environment.PORT, "38473");
  assert.equal(serverOptions.environment.PI_WEB_PARENT_PID, "55");
  assert.equal(serverOptions.environment.PI_DESKTOP_INSTANCE_ID, "instance-c");
  assert.equal(serverOptions.environment.PI_DESKTOP_API_TOKEN, undefined);
  assert.equal(serverOptions.currentDirectory, "/opt/pi-agent/resources/server");
  assert.equal(
    serverOptions.scriptPath,
    "/opt/pi-agent/resources/server/desktop-server.cjs",
  );
  assert.match(serverOptions.environment.PATH, /^\/opt\/pi-agent\/resources\/node:/);
});

test("serve refuses to overwrite state owned by a replacement instance", async () => {
  const events = [];
  const launcher = createKylinLauncher({
    environment: { PATH: "/usr/bin", PI_KYLIN_INSTANCE_ID: "old-instance" },
    installRoot: "/opt/pi-agent",
    ensureDirectories: async () => {},
    validateResources: async () => {},
    choosePort: async () => 38473,
    readState: async () => ({
      supervisorPid: 99,
      port: 38474,
      instanceId: "new-instance",
      phase: "running",
    }),
    withLaunchLock: async (operation) => operation(),
    spawnServer: async () => ({
      wait: async () => assert.fail("unclaimed server must not keep running"),
      terminate: async () => events.push("terminate"),
    }),
    waitForServerIdentity: async () => {},
    writeState: async () => events.push("write"),
    removeStateIfOwned: async () => {},
  });

  assert.equal(await launcher.run(["serve"]), 1);
  assert.deepEqual(events, ["terminate"]);
});

test("serve terminates its child and removes its reservation when identity startup fails", async () => {
  const events = [];
  const launcher = createKylinLauncher({
    environment: { PATH: "/usr/bin", PI_KYLIN_INSTANCE_ID: "failed-instance" },
    installRoot: "/opt/pi-agent",
    ensureDirectories: async () => {},
    validateResources: async () => {},
    choosePort: async () => 38473,
    spawnServer: async () => ({
      wait: async () => new Promise(() => {}),
      terminate: async () => events.push("terminate"),
    }),
    waitForServerIdentity: async () => {
      throw new Error("identity startup failed");
    },
    withLaunchLock: async (operation) => operation(),
    removeStateIfOwned: async (state) => events.push(`remove:${state.instanceId}`),
  });

  await assert.rejects(launcher.run(["serve"]), /identity startup failed/);
  assert.deepEqual(events, ["terminate", "remove:failed-instance"]);
});
