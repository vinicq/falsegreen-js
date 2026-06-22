# References

falsegreen-js detects false-green test smells in JS/TS. Its catalog draws on the
academic test-smell literature and on existing detection tools. This file credits
those sources and maps each to the codes it informs.

## Founding and conceptual

- **van Deursen, Moonen, van den Bergh, Kok (2001).** "Refactoring Test Code." XP 2001.
  The original catalog of 11 test smells. Source of the general vocabulary.
- **Delplanque, Ducasse, Polito, Black, Etien (2019).** "Rotten Green Tests." ICSE 2019.
  Green tests whose assertions never execute. The conceptual origin of the
  "false-green" framing and of codes JS2, JS6, JS9, JS11 (assertion present but
  unreachable). Cross-language extension: EMSE 2021.

## JS/TS empirical and tooling

- **Jorge, D. N. (2023).** "Uma investigação sobre Test Smells em códigos de testes
  JavaScript." PhD thesis, PPGCC/UFCG. Static analysis of 16 test smells over 65 JS
  projects. Closest sibling study; maps to C2, C2b, C5, C16, JS4.
- **Silva, A. C. (2022).** "Identificação e Caracterização de Test Smells em JavaScript."
  PUC Minas. Proposes the JS-specific smells **Only Test** and **Complex Snapshot** —
  the academic precedent for **JS1** and **JS3**.
- **Oliveira et al. (2024).** "SNUTS.js: Sniffing Nasty Unit Test Smells in JavaScript."
  SBES 2024. JS test-smell detector; informs C8 (sensitive equality) scope.
- **Oliveira et al. (2025).** "Identifying and Addressing Test Smells in JavaScript: A
  Developer-Centric Study." SBES 2025. Motivation: developers miss subtle smells.

## Detection-tool baselines

- **Peruma, Almalki, Newman, Mkaouer, Ouni, Palomba (2020).** "tsDetect: An Open Source
  Test Smells Detection Tool." ESEC/FSE 2020. The de facto Java baseline (~96% precision).
- **marabesi/smelly-test.** JS/TS test-smell detector (TypeScript compiler API), the
  closest tooling analogue; informs JS6 (empty describe).
- **Panichella, Panichella, Beller, Zaidman et al. (2022).** "Test Smells 20 Years Later."
  EMSE. Methodological caution: catalog agreement is not perceived quality.

## React / frontend (scope note)

- **Ferreira & Valente (2023).** "Detecting code smells in React-based Web apps." IST 155.
  React **production** code smells (ReactSniffer). Cited to mark the boundary:
  those are not test smells and are out of scope for a test-file scanner.

## Code-to-source map

| Code | Primary source(s) |
|---|---|
| C2, C2b | van Deursen 2001; Jorge 2023 (Empty/Unknown Test) |
| C5, C7 | Redundant Assertion (Jorge 2023; tsDetect) |
| C8 | Sensitive Equality (SNUTS.js 2024) |
| C16 | Sleepy Test (Jorge 2023) |
| JS1 | Only Test (Silva 2022) |
| JS3 | Complex Snapshot (Silva 2022) |
| JS2, JS6, JS9, JS11 | Rotten Green Tests (Delplanque 2019) |
| JS4 | Ignored Test (Jorge 2023; tsDetect) |
| JS5 | Testing Library async guidance (community practice) |
| CC | community practice (commented-out assertion) |

Detailed per-source notes and the running research live in a separate private study.
