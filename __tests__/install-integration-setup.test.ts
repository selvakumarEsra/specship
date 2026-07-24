/**
 * INSTALL-INTEG-SETUP-DOC — the installer offers integration setup after
 * enabling an integration. Covers the pure planner (REQ-INSTALL-INTEG-001)
 * and the best-effort runner (REQ-INSTALL-INTEG-002).
 *
 * @verifies REQ-INSTALL-INTEG-001
 * @verifies REQ-INSTALL-INTEG-002
 */

import { describe, it, expect, vi } from 'vitest';
import {
  planIntegrationSetup,
  runIntegrationSetup,
  type IntegrationSetupProbes,
  type SetupClack,
} from '../src/installer/integration-setup';

const probes = (over: Partial<IntegrationSetupProbes> = {}): IntegrationSetupProbes => ({
  jiraConfigured: () => false,
  commandOnPath: () => true,
  ...over,
});

describe('planIntegrationSetup (REQ-INSTALL-INTEG-001)', () => {
  it('A1: withJira + interactive + not configured + specship on PATH → offer configure', () => {
    const plan = planIntegrationSetup({ withJira: true, useDefaults: false }, probes());
    expect(plan.steps).toEqual([{ integration: 'jira', action: 'offer-configure' }]);
  });

  it('A2: useDefaults (--yes) → empty plan regardless of flags', () => {
    const plan = planIntegrationSetup(
      { withJira: true, withDesigner: true, useDefaults: true },
      probes(),
    );
    expect(plan.steps).toEqual([]);
  });

  it('A3: withJira but already configured → note, not offer', () => {
    const plan = planIntegrationSetup(
      { withJira: true, useDefaults: false },
      probes({ jiraConfigured: () => true }),
    );
    expect(plan.steps).toEqual([{ integration: 'jira', action: 'note-configured' }]);
  });

  it('does not offer jira configure when the specship binary is not on PATH', () => {
    const plan = planIntegrationSetup(
      { withJira: true, useDefaults: false },
      probes({ commandOnPath: (c) => c !== 'specship' }),
    );
    expect(plan.steps).toEqual([]);
  });

  it('A4: withDesigner offers setup when `designer` is on PATH, else instructs', () => {
    const withCmd = planIntegrationSetup(
      { withDesigner: true, useDefaults: false },
      probes({ commandOnPath: (c) => c === 'designer' }),
    );
    expect(withCmd.steps).toEqual([{ integration: 'designer', action: 'offer-setup' }]);

    const noCmd = planIntegrationSetup(
      { withDesigner: true, useDefaults: false },
      probes({ commandOnPath: () => false }),
    );
    expect(noCmd.steps).toEqual([{ integration: 'designer', action: 'instruct-setup' }]);
  });

  it('A5: no integration flags → empty plan', () => {
    expect(planIntegrationSetup({ useDefaults: false }, probes()).steps).toEqual([]);
  });

  it('plans both integrations together', () => {
    const plan = planIntegrationSetup(
      { withJira: true, withDesigner: true, useDefaults: false },
      probes({ commandOnPath: () => true }),
    );
    expect(plan.steps).toEqual([
      { integration: 'jira', action: 'offer-configure' },
      { integration: 'designer', action: 'offer-setup' },
    ]);
  });
});

function fakeClack(confirmReturn: boolean | symbol = true): { clack: SetupClack; logs: string[] } {
  const logs: string[] = [];
  const clack: SetupClack = {
    confirm: async () => confirmReturn,
    isCancel: (v) => typeof v === 'symbol',
    log: {
      info: (m) => logs.push(`info:${m}`),
      success: (m) => logs.push(`success:${m}`),
      warn: (m) => logs.push(`warn:${m}`),
      error: (m) => logs.push(`error:${m}`),
    },
  };
  return { clack, logs };
}

describe('runIntegrationSetup (REQ-INSTALL-INTEG-002)', () => {
  it('A2: accepting the jira offer spawns `specship jira configure`', async () => {
    const spawn = vi.fn(async () => 0);
    const { clack } = fakeClack(true);
    await runIntegrationSetup(
      { steps: [{ integration: 'jira', action: 'offer-configure' }] },
      clack,
      spawn,
    );
    expect(spawn).toHaveBeenCalledWith('specship', ['jira', 'configure']);
  });

  it('A2: accepting the designer offer spawns `designer setup`', async () => {
    const spawn = vi.fn(async () => 0);
    const { clack } = fakeClack(true);
    await runIntegrationSetup(
      { steps: [{ integration: 'designer', action: 'offer-setup' }] },
      clack,
      spawn,
    );
    expect(spawn).toHaveBeenCalledWith('designer', ['setup']);
  });

  it('A1: declining the offer spawns nothing and completes', async () => {
    const spawn = vi.fn(async () => 0);
    const { clack, logs } = fakeClack(false);
    await runIntegrationSetup(
      { steps: [{ integration: 'jira', action: 'offer-configure' }] },
      clack,
      spawn,
    );
    expect(spawn).not.toHaveBeenCalled();
    expect(logs.some((l) => l.startsWith('info:Skipped'))).toBe(true);
  });

  it('A1: a cancelled prompt is treated as decline', async () => {
    const spawn = vi.fn(async () => 0);
    const { clack } = fakeClack(Symbol('cancel'));
    await runIntegrationSetup(
      { steps: [{ integration: 'jira', action: 'offer-configure' }] },
      clack,
      spawn,
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('A2: a non-zero setup exit is warned but does not throw', async () => {
    const spawn = vi.fn(async () => 3);
    const { clack, logs } = fakeClack(true);
    await expect(
      runIntegrationSetup(
        { steps: [{ integration: 'jira', action: 'offer-configure' }] },
        clack,
        spawn,
      ),
    ).resolves.toBeUndefined();
    expect(logs.some((l) => l.startsWith('warn:') && l.includes('exited with code 3'))).toBe(true);
  });

  it('note/instruct steps print without prompting or spawning', async () => {
    const spawn = vi.fn(async () => 0);
    const confirm = vi.fn(async () => true);
    const { clack, logs } = fakeClack(true);
    clack.confirm = confirm;
    await runIntegrationSetup(
      {
        steps: [
          { integration: 'jira', action: 'note-configured' },
          { integration: 'designer', action: 'instruct-setup' },
        ],
      },
      clack,
      spawn,
    );
    expect(spawn).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes('already configured'))).toBe(true);
    expect(logs.some((l) => l.includes('designer setup'))).toBe(true);
  });

  it('a spawn that throws never fails the run', async () => {
    const spawn = vi.fn(async () => { throw new Error('ENOENT'); });
    const { clack, logs } = fakeClack(true);
    await expect(
      runIntegrationSetup(
        { steps: [{ integration: 'designer', action: 'offer-setup' }] },
        clack,
        spawn,
      ),
    ).resolves.toBeUndefined();
    expect(logs.some((l) => l.startsWith('warn:'))).toBe(true);
  });
});
