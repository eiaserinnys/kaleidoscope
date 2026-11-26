export const escapePointer = (part: string) => part.replace(/~/g, "~0").replace(/\//g, "~1");
