/**
 * Seed dataset for the MCP servers page (REQ-MCP-006).
 *
 * Ported from the "SpecShip Desktop" Claude Design `screens-mcp.jsx` reference.
 * The MCP page renders this when `/api/mcp/servers` is unavailable or returns no
 * servers, so the page is meaningful before a live MCP-introspection endpoint
 * exists. The runtime fields (uptime, protocol, per-tool stats, usedBy) are
 * illustrative — `[needs review]` until a real source is wired.
 */
import type { McpServersResponse } from './types';

export const MCP_SEED: McpServersResponse = {
  servers: [
    {
      id: 'specship',
      name: 'specship',
      scope: 'project',
      icon: 'graph',
      color: 'var(--node-spec)',
      state: 'running',
      version: '0.4.0',
      protocol: '2025-06-18',
      uptime: '4h 12m',
      transport: 'stdio',
      command: 'npx specship mcp',
      desc: 'SpecShip’s own server — structural code intelligence over the spec↔code graph.',
      tools: [
        {
          name: 'specship_explore',
          icon: 'graph',
          color: 'var(--node-code)',
          desc: 'Return the callers, callees and linked specs for a symbol — the structural alternative to re-reading files.',
          params: [
            { name: 'symbol', type: 'string', required: true },
            { name: 'depth', type: 'int', required: false, hint: '2' },
            { name: 'include', type: 'enum', required: false, hint: 'callers|callees|specs' },
          ],
          example: 'specship_explore --symbol validateSession --depth 2',
          stat: { calls: 88, tokens: 540000 },
          drill: true,
        },
        {
          name: 'specship_search',
          icon: 'search',
          color: 'var(--node-spec)',
          desc: 'Indexed structural search across the graph for call sites, definitions and references — returns qualified symbols, not raw lines.',
          params: [
            { name: 'query', type: 'string', required: true },
            { name: 'kind', type: 'enum', required: false, hint: 'call-site|def|ref' },
            { name: 'limit', type: 'int', required: false, hint: '50' },
          ],
          example: "specship_search 'parseTranscript' --kind call-site",
          stat: { calls: 64, tokens: 210000 },
          drill: true,
        },
        {
          name: 'specship_links',
          icon: 'book',
          color: 'var(--node-route)',
          desc: 'List spec↔code links and their verification state. Filter by requirement id or state.',
          params: [
            { name: 'spec', type: 'string', required: false },
            { name: 'state', type: 'enum', required: false, hint: 'verified|drifted|broken' },
          ],
          example: 'specship_links --spec REQ-AUTH-005',
          stat: { calls: 31, tokens: 74000 },
        },
        {
          name: 'specship_drift',
          icon: 'drift',
          color: 'var(--warn)',
          desc: 'Detect links that have drifted since they were last verified. Powers the drift queue.',
          params: [
            { name: 'path', type: 'string', required: false },
            { name: 'since', type: 'string', required: false, hint: 'HEAD~1' },
          ],
          example: 'specship_drift --path src/ingest/',
          stat: { calls: 19, tokens: 28000 },
        },
        {
          name: 'specship_impact',
          icon: 'compare',
          color: 'var(--node-test)',
          desc: 'Trace the blast radius of a change — every symbol, test and spec downstream of an edit.',
          params: [
            { name: 'symbol', type: 'string', required: true },
            { name: 'depth', type: 'int', required: false, hint: '3' },
          ],
          example: 'specship_impact --symbol tailFrom',
          stat: { calls: 12, tokens: 51000 },
        },
      ],
      usedBy: [
        { name: 'Claude Code', host: 'stdio · ~/dev/specship', state: 'active', last: 'active now' },
        { name: 'Claude Desktop', host: 'stdio · global', state: 'connected', last: '12m ago' },
        { name: 'Cursor', host: 'stdio · workspace', state: 'idle', last: '3h ago' },
      ],
      config: `{
  "mcpServers": {
    "specship": {
      "command": "npx",
      "args": ["specship", "mcp"],
      "env": { "SPECSHIP_ROOT": "~/dev/specship" }
    }
  }
}`,
    },
    {
      id: 'filesystem',
      name: 'filesystem',
      scope: 'global',
      icon: 'folder',
      color: 'var(--node-route)',
      state: 'running',
      version: '0.6.2',
      protocol: '2025-06-18',
      uptime: '1d 6h',
      transport: 'stdio',
      command: 'npx -y @modelcontextprotocol/server-filesystem ~/dev',
      desc: 'Sandboxed read/write access to files under an allowed root directory.',
      tools: [
        {
          name: 'read_file',
          icon: 'book',
          color: 'var(--node-route)',
          desc: 'Read the complete contents of a file from the allowed directories.',
          params: [{ name: 'path', type: 'string', required: true }],
          example: 'read_file --path src/index.ts',
          stat: { calls: 142, tokens: 980000 },
        },
        {
          name: 'write_file',
          icon: 'reveal',
          color: 'var(--node-route)',
          desc: 'Create a new file or overwrite an existing one with new contents.',
          params: [
            { name: 'path', type: 'string', required: true },
            { name: 'content', type: 'string', required: true },
          ],
          example: 'write_file --path notes.md',
          stat: { calls: 24, tokens: 60000 },
        },
        {
          name: 'list_directory',
          icon: 'folder',
          color: 'var(--node-route)',
          desc: 'List files and directories at a given path with type annotations.',
          params: [{ name: 'path', type: 'string', required: true }],
          example: 'list_directory --path src/',
          stat: { calls: 58, tokens: 120000 },
        },
        {
          name: 'search_files',
          icon: 'search',
          color: 'var(--node-route)',
          desc: 'Recursively search for files matching a pattern under a directory.',
          params: [
            { name: 'path', type: 'string', required: true },
            { name: 'pattern', type: 'string', required: true },
          ],
          example: "search_files --pattern '*.test.ts'",
          stat: { calls: 33, tokens: 210000 },
        },
      ],
      usedBy: [
        { name: 'Claude Desktop', host: 'stdio · global', state: 'active', last: 'active now' },
        { name: 'Claude Code', host: 'stdio · inherited', state: 'connected', last: '20m ago' },
      ],
      config: `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "~/dev"]
    }
  }
}`,
    },
    {
      id: 'github',
      name: 'github',
      scope: 'global',
      icon: 'external',
      color: 'var(--node-code)',
      state: 'running',
      version: '0.5.0',
      protocol: '2025-06-18',
      uptime: '1d 6h',
      transport: 'stdio',
      command: 'npx -y @modelcontextprotocol/server-github',
      desc: 'Read and write GitHub repos, issues and pull requests via a personal access token.',
      tools: [
        {
          name: 'search_repositories',
          icon: 'search',
          color: 'var(--node-code)',
          desc: 'Search GitHub repositories by query, language and stars.',
          params: [
            { name: 'query', type: 'string', required: true },
            { name: 'perPage', type: 'int', required: false, hint: '30' },
          ],
          example: "search_repositories --query 'mcp server'",
          stat: { calls: 14, tokens: 88000 },
        },
        {
          name: 'get_file_contents',
          icon: 'book',
          color: 'var(--node-code)',
          desc: 'Fetch the contents of a file or directory from a repository.',
          params: [
            { name: 'owner', type: 'string', required: true },
            { name: 'repo', type: 'string', required: true },
            { name: 'path', type: 'string', required: true },
          ],
          example: 'get_file_contents --repo anthropics/mcp',
          stat: { calls: 22, tokens: 140000 },
        },
        {
          name: 'create_issue',
          icon: 'drift',
          color: 'var(--node-code)',
          desc: 'Open a new issue on a repository with a title, body and labels.',
          params: [
            { name: 'owner', type: 'string', required: true },
            { name: 'repo', type: 'string', required: true },
            { name: 'title', type: 'string', required: true },
          ],
          example: "create_issue --title 'Drifted link'",
          stat: { calls: 4, tokens: 12000 },
        },
        {
          name: 'create_pull_request',
          icon: 'compare',
          color: 'var(--node-code)',
          desc: 'Create a pull request from a head branch into a base branch.',
          params: [
            { name: 'owner', type: 'string', required: true },
            { name: 'repo', type: 'string', required: true },
            { name: 'head', type: 'string', required: true },
            { name: 'base', type: 'string', required: true },
          ],
          example: 'create_pull_request --head feat/mcp',
          stat: { calls: 3, tokens: 9000 },
        },
      ],
      usedBy: [
        { name: 'Claude Code', host: 'stdio · ~/dev/specship', state: 'connected', last: '1h ago' },
      ],
      config: `{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "\${GITHUB_TOKEN}" }
    }
  }
}`,
    },
    {
      id: 'postgres',
      name: 'postgres',
      scope: 'project',
      icon: 'database',
      color: 'var(--node-test)',
      state: 'running',
      version: '0.6.2',
      protocol: '2025-06-18',
      uptime: '4h 12m',
      transport: 'stdio',
      command: 'npx -y @modelcontextprotocol/server-postgres postgresql://localhost/specship',
      desc: 'Read-only SQL access to the local SpecShip database for schema-aware queries.',
      tools: [
        {
          name: 'query',
          icon: 'database',
          color: 'var(--node-test)',
          desc: 'Run a read-only SQL query against the connected database and return rows.',
          params: [{ name: 'sql', type: 'string', required: true }],
          example: "query --sql 'select count(*) from nodes'",
          stat: { calls: 27, tokens: 64000 },
        },
      ],
      usedBy: [
        { name: 'Claude Code', host: 'stdio · ~/dev/specship', state: 'connected', last: '40m ago' },
      ],
      config: `{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres",
               "postgresql://localhost/specship"]
    }
  }
}`,
    },
    {
      id: 'sentry',
      name: 'sentry',
      scope: 'global',
      icon: 'drift',
      color: 'var(--error)',
      state: 'error',
      version: 'remote',
      protocol: '—',
      uptime: '—',
      transport: 'http (sse)',
      command: 'https://mcp.sentry.dev/sse',
      desc: 'Pull issues and stack traces from Sentry. Connection is failing — the OAuth token has expired.',
      error: '401 Unauthorized — token expired. Re-authenticate to restore the connection.',
      tools: [],
      usedBy: [
        { name: 'Claude Code', host: 'http · remote', state: 'idle', last: 'failed 8m ago' },
      ],
      config: `{
  "mcpServers": {
    "sentry": {
      "type": "http",
      "url": "https://mcp.sentry.dev/sse"
    }
  }
}`,
    },
    {
      id: 'playwright',
      name: 'playwright',
      scope: 'project',
      icon: 'reveal',
      color: 'var(--text-muted)',
      state: 'disabled',
      version: '0.0.27',
      protocol: '—',
      uptime: '—',
      transport: 'stdio',
      command: 'npx -y @playwright/mcp',
      desc: 'Drive a real browser for end-to-end checks. Disabled in this workspace — enable to expose its tools.',
      tools: [
        {
          name: 'browser_navigate',
          icon: 'external',
          color: 'var(--text-muted)',
          desc: 'Navigate the browser to a URL.',
          params: [{ name: 'url', type: 'string', required: true }],
          example: 'browser_navigate --url http://localhost:3000',
          stat: { calls: 0, tokens: 0 },
        },
        {
          name: 'browser_snapshot',
          icon: 'reveal',
          color: 'var(--text-muted)',
          desc: 'Capture an accessibility snapshot of the current page.',
          params: [],
          example: 'browser_snapshot',
          stat: { calls: 0, tokens: 0 },
        },
        {
          name: 'browser_click',
          icon: 'box',
          color: 'var(--text-muted)',
          desc: 'Click an element identified by its accessibility ref.',
          params: [{ name: 'ref', type: 'string', required: true }],
          example: 'browser_click --ref button-submit',
          stat: { calls: 0, tokens: 0 },
        },
      ],
      usedBy: [],
      config: `{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp"],
      "disabled": true
    }
  }
}`,
    },
  ],
};
