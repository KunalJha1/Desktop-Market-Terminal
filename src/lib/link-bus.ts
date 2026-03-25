/** Simple pub/sub event bus for linking components by channel */
type Listener = (symbol: string) => void;

const listeners = new Map<number, Set<Listener>>();
const latestSymbols = new Map<number, string>();

export const linkBus = {
  subscribe(channel: number, callback: Listener): () => void {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(callback);
    const latest = latestSymbols.get(channel);
    if (latest) callback(latest);
    return () => {
      listeners.get(channel)?.delete(callback);
    };
  },

  publish(channel: number, symbol: string): void {
    latestSymbols.set(channel, symbol);
    listeners.get(channel)?.forEach((cb) => cb(symbol));
  },
};
