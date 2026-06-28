// falsegreen-js examples - Cypress query chains (RiskGroup: effectiveness).
//
// Code: JS24
//
// A Cypress query (cy.get / cy.find / cy.contains) with no terminating
// .should/.and and no expect in a .then leaves its subject unasserted. This
// lives in a .cy.ts file so the scanner reads it as a Cypress spec. It is a
// scan target, not a runnable suite.

// --- JS24: cy.get used as a statement with no terminating assertion ----------

// BAD: the query produces a subject that is never asserted.
it("js24 loose cy query", () => { cy.get(".btn"); });

// CLEAN: the chain ends in .should, a real assertion.
it("js24 should clean", () => { cy.get(".btn").should("be.visible"); });
