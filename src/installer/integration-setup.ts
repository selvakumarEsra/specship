/**
 * Post-install integration setup (INSTALL-INTEG-SETUP-DOC).
 *
 * `specship install --with-jira` / `--with-designer` only ENABLE a tool group
 * (write SPECSHIP_INTEGRATIONS). The actual setup — JIRA credentials, the
 * Designer debug-Chrome session — is a separate command. After a successful
 * interactive install, we offer to run that setup step here, reusing the
 * existing `specship jira configure` / `designer setup` commands rather than
 * reimplementing credential capture.
 *
 * The decision is a PURE planner (unit tested); the runner is a thin
 * prompt+spawn shell that never fails the install.
 */

import { execSync } from 'child_process';

/** One planned follow-up for an enabled integration. */
export type IntegrationSetupStep =
  | { integration: 'jira'; action: 'offer-configure' }
  | { integration: 'jira'; action: 'note-configured' }
  | { integration: 'designer'; action: 'offer-setup' }
  | { integration: 'designer'; action: 'instruct-setup' };

export interface IntegrationSetupPlan {
  steps: IntegrationSetupStep[];
}

/** Probes the planner needs — injected so it stays pure + testable. */
export interface IntegrationSetupProbes {
  /** Whether JIRA already has resolvable config/credentials. */
  jiraConfigured: () => boolean;
  /** Whether a command resolves on PATH (e.g. `specship`, `designer`). */
  commandOnPath: (cmd: string) => boolean;
}

export interface IntegrationSetupInput {
  withJira?: boolean;
  withDesigner?: boolean;
  /** `--yes` / non-interactive: no prompts, no spawns (secrets can't be captured). */
  useDefaults: boolean;
}

/**
 * Decide the follow-up for each enabled integration (REQ-INSTALL-INTEG-001).
 * Pure: no prompting, no spawning, no I/O beyond the injected probes.
 */
export function planIntegrationSetup(
  input: IntegrationSetupInput,
  probes: IntegrationSetupProbes,
): IntegrationSetupPlan {
  const steps: IntegrationSetupStep[] = [];

  // Non-interactive installs never prompt for or run setup (A2).
  if (input.useDefaults) return { steps };

  if (input.withJira) {
    if (probes.jiraConfigured()) {
      // Already configured — don't re-offer; a quiet note is enough (A3).
      steps.push({ integration: 'jira', action: 'note-configured' });
    } else if (probes.commandOnPath('specship')) {
      steps.push({ integration: 'jira', action: 'offer-configure' });
    }
    // No specship on PATH → step 1 of the installer already warned loudly;
    // don't offer to spawn a command we can't resolve.
  }

  if (input.withDesigner) {
    // `designer setup` is an EXTERNAL command (the browser side), not a
    // specship subcommand — only offer to run it when it's actually present
    // (A4); otherwise fall back to the one-time instruction.
    steps.push({
      integration: 'designer',
      action: probes.commandOnPath('designer') ? 'offer-setup' : 'instruct-setup',
    });
  }

  return { steps };
}

/** Default PATH probe: `command -v` / `where`, exit code only. */
export function commandOnPath(cmd: string): boolean {
  try {
    const probe = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(probe, {
      stdio: 'ignore',
      windowsHide: true,
      shell: process.platform === 'win32' ? undefined : '/bin/sh',
    });
    return true;
  } catch {
    return false;
  }
}

/** Minimal clack surface the runner needs (subset of @clack/prompts). */
export interface SetupClack {
  confirm: (opts: { message: string; initialValue?: boolean }) => Promise<boolean | symbol>;
  isCancel: (v: unknown) => boolean;
  log: {
    info: (m: string) => void;
    success: (m: string) => void;
    warn: (m: string) => void;
    error: (m: string) => void;
  };
}

/** Spawn a setup command with inherited stdio; resolves to its exit code. */
export type SetupSpawn = (command: string, args: string[]) => Promise<number>;

/**
 * Execute the plan (REQ-INSTALL-INTEG-002). Runs AFTER the install writes
 * succeed. Never throws — a declined offer, cancel, or non-zero setup exit
 * leaves the install successful (the wiring is already written).
 */
export async function runIntegrationSetup(
  plan: IntegrationSetupPlan,
  clack: SetupClack,
  spawn: SetupSpawn,
): Promise<void> {
  for (const step of plan.steps) {
    try {
      if (step.integration === 'jira' && step.action === 'note-configured') {
        clack.log.info('JIRA is already configured (~/.specship/jira.json). Re-run `specship jira configure` to change it.');
        continue;
      }
      if (step.integration === 'designer' && step.action === 'instruct-setup') {
        clack.log.info('Designer enabled. Set up the browser side once with `designer setup` (installs/launches the debug Chrome session).');
        continue;
      }

      const isJira = step.integration === 'jira';
      const message = isJira
        ? 'Configure JIRA credentials now? (connects your Atlassian instance)'
        : 'Set up the Designer browser session now? (launches a signed-in debug Chrome)';
      const ans = await clack.confirm({ message, initialValue: true });
      if (clack.isCancel(ans) || ans !== true) {
        clack.log.info(
          isJira
            ? 'Skipped — run `specship jira configure` when ready.'
            : 'Skipped — run `designer setup` when ready.',
        );
        continue;
      }

      const [command, args] = isJira
        ? ['specship', ['jira', 'configure']]
        : ['designer', ['setup']];
      const code = await spawn(command as string, args as string[]);
      if (code !== 0) {
        clack.log.warn(
          `${command} ${args.join(' ')} exited with code ${code}. The install is complete; re-run that command to finish setup.`,
        );
      }
    } catch (err) {
      // A setup fault must never fail the install.
      const msg = err instanceof Error ? err.message : String(err);
      clack.log.warn(`Integration setup step skipped (${msg}). Run the setup command manually when ready.`);
    }
  }
}
