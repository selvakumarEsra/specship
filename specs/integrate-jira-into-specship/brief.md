---
slug: integrate-jira-into-specship
created: 2026-07-06
label: jira
---
# Integrate JIRA: list my assigned issues, pick one by id, run the implement→test→PR workflow

Integrate JIRA into SpecShip so a solo developer can drive work straight from
their board:

- **Auth** — connect with an Atlassian API token (JIRA Cloud) or a Personal
  Access Token (JIRA Data Center / Server).
- **List** — the user asks to list all JIRA issues on the board assigned to
  them (their own name), by project/board.
- **Pick** — the user picks an item by passing its JIRA id.
- **Run** — that kicks off the SpecShip workflow to implement, test, and raise
  a PR for the picked issue (reuse the existing spec-implement → verify → PR
  path).
- **Track** — status flows back to JIRA: the issue's status reflects where the
  work is (in progress, PR raised, done), so the board stays the source of
  truth.

Goal: a simplified, low-ceremony way for **solo developers** to use JIRA to get
tasks listed, implemented, and tracked — pick an id, let SpecShip do the
implement/test/PR loop, and see status without leaving the flow.
