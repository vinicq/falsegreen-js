import ts from "typescript";
import * as path from "node:path";

/** Map a file extension to the TypeScript ScriptKind so JSX/TSX parse correctly. */
export function scriptKindFor(file: string): ts.ScriptKind {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".ts":
    case ".mts":
    case ".cts":
      return ts.ScriptKind.TS;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

/** Parse source text into a SourceFile (setParentNodes=true so we can walk up). */
export function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindFor(file),
  );
}

/** 1-based line number of a node's start, from the SourceFile line map. */
export function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}
