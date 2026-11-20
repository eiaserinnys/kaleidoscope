import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installShellDragGuard } from "@kaleidoscope/ui";
import { installKeyboardScrollRestore } from "./shell/keyboard-viewport";
import "@kaleidoscope/ui/styles.css";
import "./index.css";
import "./shell.css";

installShellDragGuard();
// iOS 가상 키보드가 닫힌 뒤 문서가 밀린 채 남지 않게 한다.
installKeyboardScrollRestore();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
