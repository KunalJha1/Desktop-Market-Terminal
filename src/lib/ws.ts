/**
 * SidecarClient — WebSocket client for Python sidecar communication.
 *
 * Features:
 * - Auto-reconnect with exponential backoff (1s → 30s)
 * - Topic-based message subscriptions by `type` field
 * - Status change callbacks for React state sync
 */

export type SidecarStatus = "connecting" | "connected" | "disconnected";

type MessageHandler = (data: Record<string, unknown>) => void;

export class SidecarClient {
  private ws: WebSocket | null = null;
  private url: string;
  private listeners = new Map<string, Set<MessageHandler>>();
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private _status: SidecarStatus = "disconnected";
  private onStatusChange: ((status: SidecarStatus) => void) | null;

  constructor(port: number, onStatusChange?: (status: SidecarStatus) => void) {
    this.url = `ws://127.0.0.1:${port}/ws`;
    this.onStatusChange = onStatusChange ?? null;
    this.connect();
  }

  get status(): SidecarStatus {
    return this._status;
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  /** Send a JSON message to the sidecar. */
  send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Subscribe to messages of a given `type`.
   * Returns an unsubscribe function.
   */
  subscribe(type: string, handler: MessageHandler): () => void {
    let handlers = this.listeners.get(type);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(type, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) this.listeners.delete(type);
    };
  }

  /** Permanently close the connection (no reconnect). */
  destroy(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus("disconnected");
  }

  // ── Internals ──────────────────────────────────────────────────────

  private connect(): void {
    if (this.intentionalClose) return;
    this.setStatus("connecting");

    const ws = new WebSocket(this.url);

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.setStatus("connected");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>;
        const type = msg.type as string | undefined;
        if (type) {
          const handlers = this.listeners.get(type);
          if (handlers) {
            for (const handler of handlers) {
              handler(msg);
            }
          }
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    ws.onclose = () => {
      this.ws = null;
      if (!this.intentionalClose) {
        this.setStatus("disconnected");
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror — reconnect happens there
    };

    this.ws = ws;
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  private setStatus(status: SidecarStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.onStatusChange?.(status);
  }
}
