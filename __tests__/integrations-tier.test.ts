import { describe, it, expect } from 'vitest';
import {
  filterIntegrationTools,
  integrationEnabled,
  toolIntegration,
  tools,
} from '../src/mcp/tools';

/**
 * INTEG-TIER-DOC (specs/integrations-tiering.md) — the MCP tool surface side
 * of REQ-INTEG-001: jira/designer tool groups exist only when the integration
 * is enabled via SPECSHIP_INTEGRATIONS (written by the install opt-in).
 */

describe('integration tool tiering (REQ-INTEG-001)', () => {
  it('A1: with no opt-in, no jira or designer tool is exposed — core tools all survive', () => {
    const visible = filterIntegrationTools(tools, {});
    expect(visible.some((t) => t.name.startsWith('specship_jira_'))).toBe(false);
    expect(visible.some((t) => t.name.startsWith('designer_'))).toBe(false);
    // Every core tool survives the filter untouched.
    const core = tools.filter((t) => toolIntegration(t.name) === null);
    expect(visible).toHaveLength(core.length);
  });

  it('A2: each integration enables exactly its own group', () => {
    const jiraOnly = filterIntegrationTools(tools, { SPECSHIP_INTEGRATIONS: 'jira' });
    expect(jiraOnly.some((t) => t.name.startsWith('specship_jira_'))).toBe(true);
    expect(jiraOnly.some((t) => t.name.startsWith('designer_'))).toBe(false);

    const both = filterIntegrationTools(tools, { SPECSHIP_INTEGRATIONS: 'jira, designer' });
    expect(both.some((t) => t.name.startsWith('specship_jira_'))).toBe(true);
    expect(both.some((t) => t.name.startsWith('designer_'))).toBe(true);
    expect(both).toHaveLength(tools.length);
  });

  it('integrationEnabled parses the env list tolerantly', () => {
    expect(integrationEnabled('jira', { SPECSHIP_INTEGRATIONS: 'designer , JIRA' })).toBe(true);
    expect(integrationEnabled('designer', {})).toBe(false);
    expect(integrationEnabled('designer', { SPECSHIP_INTEGRATIONS: '' })).toBe(false);
  });

  it('toolIntegration classifies every shipped tool into exactly core/jira/designer', () => {
    for (const t of tools) {
      const integ = toolIntegration(t.name);
      if (t.name.startsWith('specship_jira_')) expect(integ).toBe('jira');
      else if (t.name.startsWith('designer_')) expect(integ).toBe('designer');
      else expect(integ).toBeNull();
    }
  });
});
