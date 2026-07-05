const { execSync } = require("node:child_process");

const PORTS = [3000, 3001];

function listeningPids(port) {
  try {
    const out = execSync("netstat -ano", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes("LISTENING")) continue;
      if (!line.includes(`:${port} `)) continue;
      const pid = line.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

let stopped = 0;
for (const port of PORTS) {
  for (const pid of listeningPids(port)) {
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      } else {
        process.kill(Number(pid), "SIGTERM");
      }
      stopped += 1;
      console.log(`[stop-dev-ports] Stopped PID ${pid} on port ${port}`);
    } catch {
      console.warn(`[stop-dev-ports] Failed to stop PID ${pid} on port ${port}`);
    }
  }
}

if (stopped === 0) {
  console.log("[stop-dev-ports] No dev listeners on 3000/3001");
}
