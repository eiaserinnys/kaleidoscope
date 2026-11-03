import type { ShellStore } from "../core/shell-store";
import * as shellErrors from "../contract/shell-errors";

export async function processRequest(store: ShellStore, window_id: string, method: string, params: any): Promise<unknown> {
  switch (method) {
    case "start": {
      const reply = await store.call({ op: "process.start", window_id, key: params.key, permission: params.permission, spec: params.spec, cwd_permission: params.cwd_permission, services: params.services ?? [] });
      return reply.result;
    }
    case "attach": return (await store.call({ op: "process.attach", window_id, key: params.key })).process;
    case "read": {
      const { bytes, next, stderr_tail, exit } = await store.call({ op: "process.read", window_id, handle: params.handle, after: params.after, max_bytes: params.max_bytes });
      return { bytes, next, stderr_tail, exit };
    }
    case "ack": await store.call({ op: "process.ack", window_id, handle: params.handle, after: params.after, checkpoint: params.checkpoint ?? null }); return null;
    case "write": {
      const input = new Uint8Array(params.bytes);
      if (store.bytes) {
        const checkpoint = new TextEncoder().encode(JSON.stringify(params.checkpoint ?? null));
        const packet = new Uint8Array(4 + checkpoint.length + input.length);
        new DataView(packet.buffer).setUint32(0, checkpoint.length);
        packet.set(checkpoint, 4); packet.set(input, 4 + checkpoint.length);
        await store.bytes({ op: "process.write", window_id, handle: params.handle }, packet.buffer);
      } else await store.call({ op: "process.write", window_id, handle: params.handle, bytes: Array.from(input), checkpoint: params.checkpoint ?? null });
      return null;
    }
    case "close_input": await store.call({ op: "process.close_input", window_id, handle: params.handle }); return null;
    case "stop": await store.call({ op: "process.stop", window_id, handle: params.handle }); return null;
    default: throw shellErrors.SHELL_CLIENT_COMMAND_UNDECLARED({ name: String(method) });
  }
}
