import { CASES, Confidence } from "./cases.js";

export interface Finding {
  file: string;
  line: number;       // 1-based
  code: string;
  detail: string;
  confidence: Confidence;
  title: string;
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
  };
}
