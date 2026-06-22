# Security policy

Thanks for reporting security issues responsibly. This page explains how to reach the
maintainer privately and what to expect.

## Which versions get fixes

falsegreen-js is in its first development cycle. Security fixes land on the latest commit
on `main`. There is no long-term support branch yet.

| Version | Supported |
|---------|-----------|
| `main`  | yes |
| tagged releases below the latest | no |

## Attack surface

The scanner reads test files and parses them with the TypeScript compiler API. It does
**not** import or execute the code it scans, so a malicious test file cannot run through
the scanner alone. The realistic concerns are narrow: a crafted file that makes the
parser hang or crash, the `--staged` path shelling out to `git`, and the generated
pre-commit hook. Reports in those areas are welcome.

## How to report a vulnerability

Do **not** open a public GitHub issue for security problems. Use a private channel:

- **GitHub Security Advisories (preferred):** <https://github.com/vinicq/falsegreen-js/security/advisories/new>
- **Email:** `vinicq@gmail.com` with the subject prefix `[falsegreen-js security]`.

Include a short description and impact, steps to reproduce (ideally a minimal test file),
the commit SHA or version tested, and whether it has been disclosed elsewhere.

## What to expect

- An acknowledgement within five business days.
- A reproduction or follow-up within ten business days.
- A fix or a clear "won't fix" rationale before any public disclosure.
- Credit in the release notes if you want it.

## What is not a security issue

File these as regular issues: a false positive or false negative (the scanner is
heuristic), slowness on a very large file, or a finding you disagree with on style grounds.
