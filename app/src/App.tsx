import { useEffect, useState } from "react";
import { createShellStore, EmptyState, LayoutGrid, TooltipProvider, type CoreTransport, type ShellStore } from "@kaleidoscope/ui";
import { createCoreTransport } from "./core/transport";
import { Shell } from "./shell/shell";

interface Runtime {
  store: ShellStore | null;
}

export default function App() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);

  useEffect(() => {
    const transport: CoreTransport | null = createCoreTransport();
    if (!transport) {
      setRuntime({ store: null });
      return;
    }

    const store = createShellStore(transport);
    let disposed = false;
    if (import.meta.env.VITE_KS_E2E === "1") {
      void import("./e2e-comment-capture").then(({ installCommentCaptureProbe }) => {
        if (!disposed) installCommentCaptureProbe(store);
      });
    }
    setRuntime({ store });
    return () => { disposed = true; store.dispose(); };
  }, []);

  if (!runtime) return <main className="app-root" />;
  if (!runtime.store) {
    return <main className="app-root"><EmptyState icon={<LayoutGrid size="empty" />} text="코어에 연결할 수 없습니다" /></main>;
  }
  return <TooltipProvider><Shell store={runtime.store} /></TooltipProvider>;
}
