import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installShellDragGuard } from "@kaleidoscope/ui";
import "@kaleidoscope/ui/styles.css";
import "./index.css";
import "./shell.css";

installShellDragGuard();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
