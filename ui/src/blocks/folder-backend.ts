export interface FolderCapabilities {
  createFile: boolean;
  createDirectory: boolean;
  rename: boolean;
  move: boolean;
  copy: boolean;
  duplicate: boolean;
  trash: boolean;
  permanentDelete: boolean;
  reveal: boolean;
  absolutePath: boolean;
  properties: boolean;
}

import type { FolderEntry } from "../contract/contract";

export interface FolderBackend {
  /** Stable identity for this device grant or account/app storage collection. */
  identity: string;
  capabilities: FolderCapabilities;
  list(parent: string): Promise<FolderEntry[]>;
}

function capabilities(values: Partial<FolderCapabilities>): FolderCapabilities {
  return {
    createFile: false,
    createDirectory: false,
    rename: false,
    move: false,
    copy: false,
    duplicate: false,
    trash: false,
    permanentDelete: false,
    reveal: false,
    absolutePath: false,
    properties: false,
    ...values,
  };
}

export function fileFolderCapabilities(writable: boolean, scope: "folder" | "pc", readOnly: boolean): FolderCapabilities {
  const canMutate = writable && scope === "folder" && !readOnly;
  return capabilities({
    createFile: canMutate,
    createDirectory: canMutate,
    rename: canMutate,
    move: canMutate,
    copy: canMutate,
    duplicate: canMutate,
    trash: canMutate,
    permanentDelete: canMutate,
    reveal: true,
    absolutePath: true,
    properties: true,
  });
}

export function collectionFolderCapabilities(): FolderCapabilities {
  return capabilities({});
}
