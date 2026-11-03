import { AppClient } from "./app.ts";

declare const __DEFAULT_AGENTS__: any[];
new AppClient((window as any).kaleidoscope, __DEFAULT_AGENTS__);
