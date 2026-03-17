import { useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import {
  BarChart3,
  FlaskConical,
  BrainCircuit,
  Linkedin,
  Github,
  Mail,
} from "lucide-react";
import { appWindow } from "@tauri-apps/api/window";
import Logo from "../components/Logo";
import WindowControls from "../components/WindowControls";

const copyByRoute: Record<string, { heading: string; subtitle: string }> = {
  "/": {
    heading: "Professional-Grade Backtesting for Smarter Trading",
    subtitle:
      "Analyze strategies, replay market structure, and access AI-assisted stock intelligence from one unified desktop workspace.",
  },
  "/signin": {
    heading: "Welcome Back to Your Trading Workspace",
    subtitle:
      "Pick up right where you left off — your strategies, charts, and market data are waiting.",
  },
  "/signup": {
    heading: "Start Building Smarter Trading Strategies",
    subtitle:
      "Create an account to unlock backtesting, AI market intelligence, and real-time IBKR integration.",
  },
  "/terms": {
    heading: "Research & Education First",
    subtitle:
      "DailyIQ Bench is built for learning and analysis — not financial advice. Please review our terms and disclaimers.",
  },
};

const features = [
  {
    icon: BarChart3,
    title: "Chart Replay & Analysis",
    desc: "Replay historical market structure with multi-timeframe custom charts built for speed.",
  },
  {
    icon: FlaskConical,
    title: "Backtesting Workflows",
    desc: "Test strategies against historical data with detailed performance metrics and equity curves.",
  },
  {
    icon: BrainCircuit,
    title: "AI Market Intelligence",
    desc: "ML-powered regime detection, options anomaly scoring, and synthetic data generation.",
  },
];

export default function AuthLayout() {
  const location = useLocation();
  const copy = copyByRoute[location.pathname] ?? copyByRoute["/"];
  const lastClickTime = useRef(0);

  return (
    <div className="relative flex h-screen w-screen flex-col bg-gradient-to-br from-[#0f172a] via-[#131d35] to-[#0a0f1a]">
      {/* Title bar drag region + window controls */}
      <div
        className="absolute inset-x-0 top-0 z-50 flex h-8 items-center justify-end bg-[#10151C]/80"
        onMouseDown={async (e) => {
          if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
          e.preventDefault();
          const now = Date.now();
          if (now - lastClickTime.current < 300) {
            lastClickTime.current = 0;
            const isMax = await appWindow.isMaximized();
            if (isMax) await appWindow.unmaximize();
            else await appWindow.maximize();
          } else {
            lastClickTime.current = now;
            appWindow.startDragging();
          }
        }}
      >
        <a
          href="https://github.com/KunalJha1"
          target="_blank"
          rel="noopener noreferrer"
          data-no-drag
          className="mr-2 font-mono text-[11px] text-white/30 transition-colors hover:text-white/60"
        >
          v{__APP_VERSION__}
        </a>
        <WindowControls />
      </div>

      {/* Main content */}
      <div className="flex flex-1 items-center justify-center gap-12 px-12 lg:gap-20 lg:px-20">
        {/* Left panel — branding */}
        <div className="hidden w-full max-w-xl flex-col gap-6 lg:flex">
          <Logo className="h-20 w-auto self-start" />

          <div className="flex flex-col gap-4">
            <h1
              key={copy.heading}
              className="auth-page-enter text-[2.75rem] font-bold leading-tight tracking-tight text-white"
            >
              {copy.heading}
            </h1>
            <p
              key={copy.subtitle}
              className="auth-page-enter max-w-md text-base leading-relaxed text-white/60"
            >
              {copy.subtitle}
            </p>
          </div>

          <div className="flex flex-col gap-5">
            {features.map((f) => (
              <div key={f.title} className="flex items-start gap-3.5">
                <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/[0.1]">
                  <f.icon className="h-[18px] w-[18px] text-[#5b9aff]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{f.title}</p>
                  <p className="text-[13px] leading-snug text-white/50">
                    {f.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel — auth card */}
        <div className="w-full max-w-md">
          <div className="rounded-2xl bg-white p-8 shadow-2xl shadow-black/20 sm:p-10">
            <div key={location.pathname} className="auth-page-enter">
              <Outlet />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-white/[0.06] px-6 py-3">
        <div className="flex items-center justify-center gap-4">
          <p className="text-[11px] text-white/25">
            Built by Kunal Jha @ UWaterloo
          </p>
          <span className="text-white/10">|</span>
          <div className="flex items-center gap-3">
            <a
              href="https://www.linkedin.com/in/kunal-jha1/"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-white/[0.08] p-1.5 text-white/40 transition-all duration-150 hover:bg-white/[0.15] hover:text-white/70"
            >
              <Linkedin className="h-3.5 w-3.5" />
            </a>
            <a
              href="https://github.com/KunalJha1"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-white/[0.08] p-1.5 text-white/40 transition-all duration-150 hover:bg-white/[0.15] hover:text-white/70"
            >
              <Github className="h-3.5 w-3.5" />
            </a>
            <a
              href="mailto:dailyiqme@gmail.com"
              className="rounded-md bg-white/[0.08] p-1.5 text-white/40 transition-all duration-150 hover:bg-white/[0.15] hover:text-white/70"
            >
              <Mail className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
