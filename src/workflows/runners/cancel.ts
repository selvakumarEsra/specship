/**
 * CancelNode runner — terminates the workflow with the given reason.
 */

import { DagNode, CancelNode } from '../schemas/workflow';
import { NodeRunner, NodeRunResult, RunnerContext } from './types';

export class CancelRunner implements NodeRunner {
  readonly kind = 'cancel' as const;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async run(rawNode: DagNode, _ctx: RunnerContext): Promise<NodeRunResult> {
    if (rawNode.kind !== 'cancel') {
      return { status: 'failed', error: `CancelRunner received ${rawNode.kind} node` };
    }
    const node = rawNode as CancelNode;
    return { status: 'cancelled', reason: node.cancel };
  }
}
