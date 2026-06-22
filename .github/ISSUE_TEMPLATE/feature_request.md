---
name: Feature request / new detection code
about: Propose a new false-green pattern to detect
title: ""
labels: detection
assignees: ""
---

## The pattern

<!-- The test smell. Remember the scope: it must let a passing test fail to protect
     anything. Maintainability/style smells are out of scope. -->

## Example (a test that passes but protects nothing)

```ts
// the problematic pattern
```

## Why it is a false positive

<!-- How can the code be wrong while this test stays green? -->

## AST-detectable?

<!-- Can a parser prove it without running the code? Which node shape? -->

## Clean look-alikes that must NOT be flagged

```ts
// correct code that resembles the pattern
```
