import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@kaleidoscope/ui/styles.css";
import "./index.css";
import "./shell.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
