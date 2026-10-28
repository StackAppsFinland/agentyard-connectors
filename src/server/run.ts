#!/usr/bin/env node
// CLI entry: run the AgentYard companion on the machine where Devin Desktop lives.
//   node dist/server/run.js --workspace "C:\Code\Stackapps" [--workspace ...]
// Env: AGENTYARD_PORT, AGENTYARD_CODE, AGENTYARD_WORKSPACES (paths split by ';'),
//      DEVIN_ACP_BIN (DevinConnector binary override).
import os from "node:os";
import { randomInt } from "node:crypto";
import { DevinConnector } from "../devin/DevinConnector.js";
import { CompanionServer } from "./CompanionServer.js";
import type { WorkspaceInfo } from "./protocol.js";

interface CliOptions {
  port: number;
  host: string;
  code: string;
  workspaces: WorkspaceInfo[];
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    port: Number(process.env.AGENTYARD_PORT) || 4000,
    host: "0.0.0.0",
    code: process.env.AGENTYARD_CODE ?? String(randomInt(0, 1_000_000)).padStart(6, "0"),
    workspaces: parseWorkspaces(process.env.AGENTYARD_WORKSPACES),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--port":
      case "-p":
        opts.port = Number(next());
        break;
      case "--host":
        opts.host = next();
        break;
      case "--workspace":
      case "-w":
        opts.workspaces.push(parseWorkspace(next()));
        break;
      case "--code":
        opts.code = next();
        break;
      case "--help":
      case "-h":
        usage(0);
    }
  }
  return opts;
}

/** "label=cwd" or bare "cwd" (label defaults to the last path segment). */
function parseWorkspace(spec: string): WorkspaceInfo {
  const eq = spec.indexOf("=");
  if (eq > 0) return { label: spec.slice(0, eq), cwd: spec.slice(eq + 1) };
  const parts = spec.split(/[\\/]/).filter(Boolean);
  return { cwd: spec, label: parts[parts.length - 1] ?? spec };
}

function parseWorkspaces(env: string | undefined): WorkspaceInfo[] {
  return env ? env.split(";").filter(Boolean).map(parseWorkspace) : [];
}

function usage(code: number): never {
  console.log(`agentyard-companion — expose local Devin Desktop tabs to the AgentYard phone app

Usage: node dist/server/run.js --workspace <cwd> [options]

Options:
  -w, --workspace <cwd|label=cwd>   Devin workspace to serve (repeatable; or AGENTYARD_WORKSPACES, ';'-separated)
  -p, --port <port>                 listen port (default 4000, env AGENTYARD_PORT)
      --host <host>                 listen host (default 0.0.0.0)
      --code <code>                 pairing code (default: random 6 digits, env AGENTYARD_CODE)
  -h, --help                        this help`);
  process.exit(code);
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.workspaces.length) {
  console.error("error: at least one --workspace is required (the Devin sessions' cwd)");
  usage(1);
}

const server = new CompanionServer({
  code: opts.code,
  workspaces: opts.workspaces,
  port: opts.port,
  host: opts.host,
  log: (m) => console.error(`[companion] ${m}`),
  connectorFactory: (permissionHandler) =>
    DevinConnector.connect({ permissionHandler, loadDrainMs: 200 }),
});

const { port } = await server.start();

console.log("AgentYard companion running.");
console.log(`Pairing code: ${opts.code}`);
console.log("Workspaces:");
for (const w of opts.workspaces) console.log(`  ${w.label ?? ""}\t${w.cwd}`);
console.log("Phone should connect to:");
for (const ip of lanAddresses()) console.log(`  ws://${ip}:${port}`);
console.log("(use one reachable from the phone's Wi-Fi; firewall may prompt on first listen)");

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === "IPv4" && !i.internal) out.push(i.address);
    }
  }
  return out.length ? out : ["127.0.0.1"];
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void server.close().then(() => process.exit(0));
  });
}
