import { existsSync } from "node:fs";
import { posix, win32 } from "node:path";

export class DevinBinaryNotFoundError extends Error {
  constructor(readonly searched: string[]) {
    super(
      "Could not locate the Devin CLI binary. Set DEVIN_ACP_BIN to the devin executable path. Searched:\n" +
        searched.map((s) => `  - ${s}`).join("\n"),
    );
    this.name = "DevinBinaryNotFoundError";
  }
}

export interface DevinBinaryLocatorOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
}

/**
 * Finds the `devin` executable that provides the `acp` subcommand.
 * Order: DEVIN_ACP_BIN / DEVIN_BIN env overrides → known install locations → PATH.
 */
export class DevinBinaryLocator {
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly exists: (path: string) => boolean;

  constructor(options: DevinBinaryLocatorOptions = {}) {
    this.env = options.env ?? process.env;
    this.platform = options.platform ?? process.platform;
    this.exists = options.exists ?? existsSync;
  }

  private get path() {
    return this.platform === "win32" ? win32 : posix;
  }

  locate(): string {
    const searched: string[] = [];
    for (const candidate of this.candidates()) {
      searched.push(candidate);
      if (this.exists(candidate)) return candidate;
    }
    const onPath = this.findOnPath(searched);
    if (onPath) return onPath;
    throw new DevinBinaryNotFoundError(searched);
  }

  private candidates(): string[] {
    const out: string[] = [];
    for (const v of [this.env.DEVIN_ACP_BIN, this.env.DEVIN_BIN]) {
      if (v) out.push(v);
    }
    switch (this.platform) {
      case "win32": {
        const local = this.env.LOCALAPPDATA ?? this.path.join(this.env.USERPROFILE ?? "", "AppData", "Local");
        out.push(this.path.join(local, "Programs", "Devin", "resources", "app", "extensions", "windsurf", "devin", "bin", "devin.exe"));
        break;
      }
      case "darwin":
        out.push("/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin");
        out.push(this.path.join(this.env.HOME ?? "", "Applications", "Devin.app", "Contents", "Resources", "app", "extensions", "windsurf", "devin", "bin", "devin"));
        break;
      default:
        out.push("/opt/devin/resources/app/extensions/windsurf/devin/bin/devin");
        out.push(this.path.join(this.env.HOME ?? "", ".local", "share", "devin", "bin", "devin"));
    }
    return out;
  }

  private findOnPath(searched: string[]): string | undefined {
    const pathEnv = this.env.PATH;
    if (!pathEnv) return undefined;
    const names = this.platform === "win32" ? ["devin.exe", "devin.cmd", "devin.bat", "devin"] : ["devin"];
    for (const dir of pathEnv.split(this.path.delimiter)) {
      if (!dir) continue;
      for (const name of names) {
        const p = this.path.join(dir, name);
        searched.push(p);
        if (this.exists(p)) return p;
      }
    }
    return undefined;
  }
}
