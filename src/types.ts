import { baseConfidence, CASES, Confidence, PyramidLevel } from "./cases.js";

export interface Finding {
  file: string;
  line: number;       // 1-based
  code: string;
  detail: string;
  confidence: Confidence;
  title: string;
  level: PyramidLevel; // unit | integration | e2e; set per file in scanFile
  snippet?: string;    // trimmed source line, set in scanFile; folded into the fingerprint
}

export function makeFinding(
  file: string,
  line: number,
  code: string,
  detail = "",
  confidence?: Confidence,
): Finding {
  return {
    file,
    line,
    code,
    detail,
    confidence: confidence ?? baseConfidence(code),
    title: CASES[code].title,
    level: "unit",
  };
}
