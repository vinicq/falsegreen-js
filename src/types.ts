import { CASES, Confidence, PyramidLevel } from "./cases.js";

export interface Finding {
  file: string;
  line: number;       // 1-based
  code: string;
  detail: string;
  confidence: Confidence;
  title: string;
  level: PyramidLevel; // unit | integration | e2e; set per file in scanFile
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
    confidence: confidence ?? CASES[code].confidence,
    title: CASES[code].title,
    level: "unit",
  };
}
