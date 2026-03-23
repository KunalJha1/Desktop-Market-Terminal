/** Simple pub/sub event bus for linking components by channel */
type Listener = (symbol: string) => void;

const listeners = new Map<number, Set<Listener>>();

export const linkBus = {
  subscribe(channel: number, callback: Listener): () => void {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(callback);
    return () => {
      listeners.get(channel)?.delete(callback);
    };
  },

  publish(channel: number, symbol: string): void {
    listeners.get(channel)?.forEach((cb) => cb(symbol));
  },
};
