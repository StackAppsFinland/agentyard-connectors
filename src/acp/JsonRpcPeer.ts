import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export class JsonRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(error: JsonRpcErrorObject) {
    super(error.message);
    this.name = "JsonRpcError";
    this.code = error.code;
    this.data = error.data;
  }
}

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
};

type NotificationHandler = (params: unknown) => void;
type RequestHandler = (params: unknown) => unknown | Promise<unknown>;

export interface JsonRpcPeerOptions {
  /** Called for requests with no registered handler. Default: -32601 error. */
  fallbackRequestHandler?: RequestHandler;
  /** Called for notifications with no registered handler. */
  fallbackNotificationHandler?: (method: string, params: unknown) => void;
  /** Called when a line fails to parse. */
  onParseError?: (line: string, err: Error) => void;
}

/**
 * Newline-delimited JSON-RPC 2.0 peer over a readable/writable stream pair —
 * the transport ACP uses on stdio.
 *
 * Bidirectional: the remote agent sends both responses and its own requests
 * (e.g. `session/request_permission`), so this is a peer, not a client.
 */
export class JsonRpcPeer {
  private readonly pending = new Map<number, PendingRequest>();
  private readonly requestHandlers = new Map<string, RequestHandler>();
  private readonly notificationHandlers = new Map<string, NotificationHandler[]>();
  private readonly emitter = new EventEmitter();
  private nextId = 1;
  private buffer = "";
  private closed = false;

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    private readonly options: JsonRpcPeerOptions = {},
  ) {
    input.on("data", (chunk: Buffer | string) => this.onData(chunk));
    input.on("end", () => this.close(new Error("input stream ended")));
    input.on("error", (err) => this.close(err));
    output.on("error", (err) => this.close(err));
  }

  request<TResult>(method: string, params?: unknown): Promise<TResult> {
    if (this.closed) return Promise.reject(new Error("peer is closed"));
    const id = this.nextId++;
    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (r) => resolve(r as TResult),
        reject,
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.send({ jsonrpc: "2.0", method, params });
  }

  onRequest(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  onNotification(method: string, handler: NotificationHandler): void {
    const list = this.notificationHandlers.get(method) ?? [];
    list.push(handler);
    this.notificationHandlers.set(method, list);
  }

  /** Emitted when the stream closes or errors; pending requests are rejected. */
  onClose(listener: (err: Error | undefined) => void): void {
    this.emitter.on("close", listener);
  }

  close(err?: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      p.reject(err ?? new Error("peer closed"));
    }
    this.pending.clear();
    this.emitter.emit("close", err);
    this.emitter.removeAllListeners();
  }

  private send(message: Record<string, unknown>): void {
    this.output.write(JSON.stringify(message) + "\n");
  }

  private onData(chunk: Buffer | string): void {
    this.buffer += chunk.toString("utf8");
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line) this.dispatch(line);
    }
  }

  private dispatch(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch (err) {
      this.options.onParseError?.(line, err as Error);
      return;
    }

    const hasMethod = typeof msg.method === "string";
    const hasId = msg.id !== undefined && msg.id !== null;

    if (hasMethod && hasId) {
      void this.handleIncomingRequest(msg.id as number | string, msg.method as string, msg.params);
    } else if (hasMethod) {
      this.handleNotification(msg.method as string, msg.params);
    } else if (hasId) {
      this.handleResponse(msg.id as number, msg);
    }
  }

  private handleResponse(id: number, msg: Record<string, unknown>): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (msg.error) {
      p.reject(new JsonRpcError(msg.error as JsonRpcErrorObject));
    } else {
      p.resolve(msg.result);
    }
  }

  private handleNotification(method: string, params: unknown): void {
    const handlers = this.notificationHandlers.get(method);
    if (handlers?.length) {
      for (const h of handlers) h(params);
    } else {
      this.options.fallbackNotificationHandler?.(method, params);
    }
  }

  private async handleIncomingRequest(id: number | string, method: string, params: unknown): Promise<void> {
    const handler = this.requestHandlers.get(method) ?? this.options.fallbackRequestHandler;
    if (!handler) {
      this.send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
      return;
    }
    try {
      const result = await handler(params);
      this.send({ jsonrpc: "2.0", id, result: result ?? null });
    } catch (err) {
      const e = err instanceof JsonRpcError
        ? { code: err.code, message: err.message, data: err.data }
        : { code: -32603, message: err instanceof Error ? err.message : String(err) };
      this.send({ jsonrpc: "2.0", id, error: e });
    }
  }
}
