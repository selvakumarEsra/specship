---
id: WF-LAUNCH-DOC
title: Workflow launch modal
owner: web-ng
priority: medium
---

<!-- id: WF-LAUNCH-DOC -->
# Workflow launch modal

The Workflows page shows a grid of available workflow definitions. To run one,
the user opens a launch modal from its card, fills in the workflow's declared
inputs, and launches the run — which starts the workflow on the server and takes
the user to the live run detail. This closes the gap where the cards were static
with no way to start a run.

The visual contract is the `RunModal` in the "SpecShip Desktop" Claude Design
`screens-workflows.jsx`. The launch is real: it POSTs to `/api/workflows/runs`
with the workflow name + entered inputs and navigates to `runs/:id` for the
returned run, rather than the design's mock fixed-id navigation.

<!-- id: REQ-WF-LAUNCH-001 -->
## A workflow card MUST open a launch modal for that workflow

Each workflow card is an activatable control. Activating it opens a modal scoped
to that workflow, showing the workflow's name and description. The modal closes
on Cancel, on its close button, on backdrop click, and on Escape, returning
focus to the page without launching anything.

implementations:
  - packages/web-ng/src/app/pages/workflows/workflows.ts:Workflows.openRun
  - packages/web-ng/src/app/pages/workflows/run-modal.ts:RunModal

## Acceptance
<!-- id: REQ-WF-LAUNCH-001.A1 -->
- Activating a workflow card (click or keyboard) MUST open the launch modal for that workflow, showing its name and description.
<!-- id: REQ-WF-LAUNCH-001.A2 -->
- The modal MUST close without launching on any of: Cancel button, close (×) button, backdrop click, or Escape.
<!-- id: REQ-WF-LAUNCH-001.A3 -->
- A click inside the modal panel MUST NOT close it (backdrop-only dismissal).

<!-- id: REQ-WF-LAUNCH-002 -->
## The modal MUST render the workflow's declared inputs and prerequisites

The modal renders one labelled text field per declared input, marking required
inputs, and shows the workflow's `requires` prerequisites as pills. A workflow
with no declared inputs MUST show a "No inputs required" note instead of an empty
form.

implementations:
  - packages/web-ng/src/app/pages/workflows/run-modal.ts:RunModal
  - packages/web-ng/src/app/pages/workflows/run-modal.html:inputs

## Acceptance
<!-- id: REQ-WF-LAUNCH-002.A1 -->
- The modal MUST render one labelled input field per `workflow.inputs` entry, with a required marker on entries flagged required.
<!-- id: REQ-WF-LAUNCH-002.A2 -->
- A workflow with zero inputs MUST render a "No inputs required" note rather than an empty input area.
<!-- id: REQ-WF-LAUNCH-002.A3 -->
- The workflow's `requires` entries MUST be shown as pills inside the modal.

<!-- id: REQ-WF-LAUNCH-003 -->
## Launching MUST start the run on the server and navigate to its detail

The Launch action POSTs the workflow name and the entered input values to the run
endpoint and, on success, navigates to the new run's detail view. While the
request is in flight the action is disabled to prevent double-submission; a
failure surfaces an error and keeps the modal open so the user can retry.

implementations:
  - packages/web-ng/src/app/pages/workflows/run-modal.ts:RunModal.launch

## Acceptance
<!-- id: REQ-WF-LAUNCH-003.A1 -->
- Launch MUST POST `{ workflowName, inputs }` to `/api/workflows/runs` with the entered values.
<!-- id: REQ-WF-LAUNCH-003.A2 -->
- On a successful response carrying a run id, the app MUST navigate to `runs/:id` for that run and close the modal.
<!-- id: REQ-WF-LAUNCH-003.A3 -->
- While the launch request is pending, the Launch control MUST be disabled so the run cannot be submitted twice.
<!-- id: REQ-WF-LAUNCH-003.A4 -->
- A failed launch MUST surface an error and leave the modal open with the entered values intact.
