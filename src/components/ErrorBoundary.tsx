import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-base p-8">
          <p className="font-mono text-[13px] font-semibold text-red">
            Something went wrong
          </p>
          <pre className="max-w-lg overflow-auto rounded border border-white/[0.08] bg-panel p-4 font-mono text-[11px] text-white/50">
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="rounded-md border border-white/[0.08] bg-panel px-4 py-1.5 font-mono text-[11px] text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white/80"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
