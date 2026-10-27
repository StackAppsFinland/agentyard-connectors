import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { JsonRpcPeer, type JsonRpcPeerOptions } from "./JsonRpcPeer.js";

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface AcpProcessOptions {
  /** Extra args after `acp`, e.g. ["--agent-type","review"]. */
  agentArgs?: string[];
  env?: NodeJS.ProcessEnv;
  spawnImpl?: SpawnFn;
  peerOptions?: JsonRpcPeerOptions;
  /** stderr lines are routed here; defaults to swallowing (the agent logs verbosely). */
  onStderr?: (line: string) => void;
}

/**
 * Spawns `devin acp` (or any ACP agent binary) and wires its stdio to a
 * {@link JsonRpcPeer}. Owns the child process lifecycle.
 */
export class AcpProcess {
  readonly peer: JsonRpcPeer;

  private constructor(
    private readonly child: ChildProcess,
    peerOptions: JsonRpcPeerOptions = {},
  ) {
    this.peer = new JsonRpcPeer(child.stdout!, child.stdin!, peerOptions);
  }

  static launch(binaryPath: string, options: AcpProcessOptions = {}): AcpProcess {
    const spawnImpl = options.spawnImpl ?? spawn;
    const child = spawnImpl(binaryPath, ["acp", ...(options.agentArgs ?? [])], {
      stdio: ["pipe", "pipe", "pipe"],
      env: options.env ?? process.env,
    });
    const proc = new AcpProcess(child, options.peerOptions ?? {});
    if (options.onStderr) {
      let buf = "";
      child.stderr!.on("data", (d: Buffer | string) => {
        buf += d.toString("utf8");
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          options.onStderr!(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      });
    } else {
      child.stderr!.resume();
    }
    child.on("exit", (code) => {
      proc.peer.close(code === 0 ? undefined : new Error(`acp process exited with code ${code}`));
    });
    return proc;
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void {
    this.child.on("exit", listener);
  }

  kill(): void {
    this.child.kill();
  }
}
