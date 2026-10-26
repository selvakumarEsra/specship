/**
 * ApprovalNode runner — emits a "paused" result.
 *
 * The runner doesn't block here; it returns an ApprovalContext that the
 * executor persists into `workflow_runs.metadata` and transitions the run
 * to `status='paused'`. The next caller of `approve(runId)` then
 * `resume(workflow, runId)` continues execution from the gate.
 *
 * This matches Archon's approval flow (manage_run.approve transitions
 * state; resume drives the next step).
 */

import { DagNode, ApprovalNode } from '../schemas/workflow';
import { NodeRunner, NodeRunResult, RunnerContext } from './types';
import { ApprovalContext } from '../../types';

export class ApprovalRunner implements NodeRunner {
  readonly kind = 'approval' as const;

  async run(rawNode: DagNode, ctx: RunnerContext): Promise<NodeRunResult> {
    if (rawNode.kind !== 'approval') {
      return { status: 'failed', error: `ApprovalRunner received ${rawNode.kind} node` };
    }
    const node = rawNode as ApprovalNode;
    // REQ-THRU-003 — a deterministic upstream check may approve this gate.
    if (node.auto_approve) {
      const upstream = ctx.outputs?.get(node.auto_approve.from)?.text ?? '';
      if (upstream.includes(node.auto_approve.marker)) {
        return {
          status: 'completed',
          output: { text: `auto-approved: ${node.auto_approve.from} reported ${node.auto_approve.marker}` },
        };
      }
    }

    const approval: ApprovalContext = {
      type: 'approval',
      nodeId: node.id,
      message: node.message,
      captureResponse: node.capture_response,
      onReject: node.on_reject,
    };

    return { status: 'paused', approval };
  }
}
