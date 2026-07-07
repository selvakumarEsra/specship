// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Deployed to Cloudflare Workers (assets-only) at the apex domain specship.cc.
// Root domain → no `base` prefix; internal links resolve at /. Code reads
// import.meta.env.BASE_URL throughout, so dropping `base` needs no link edits.
export default defineConfig({
	site: 'https://specship.cc',
	integrations: [
		starlight({
			title: 'SpecShip',
			description:
				'Workflow engine for AI coding agents. Define multi-step development workflows in YAML — code review, bug fixes, feature implementation — and run them with one command, in isolated git worktrees, from the CLI, web UI, or GitHub Actions.',
			favicon: '/favicon.svg',
			head: [
				{
					// Sniff system preference on first visit. Subsequent visits respect
					// whatever toggle the user picked, persisted in localStorage by Starlight.
					tag: 'script',
					content:
						"try{const k='starlight-theme';if(!localStorage.getItem(k)){const d=window.matchMedia('(prefers-color-scheme: dark)').matches;localStorage.setItem(k,d?'dark':'light');document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.style.colorScheme=d?'dark':'light';}}catch(e){}",
				},
				// Default social-share image for docs pages (Starlight sets og:title/description per page).
				{ tag: 'meta', attrs: { property: 'og:image', content: 'https://specship.cc/og.png' } },
				{ tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
				{ tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
				{ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
				{ tag: 'meta', attrs: { name: 'twitter:image', content: 'https://specship.cc/og.png' } },
			],
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/selvakumarEsra/specship',
				},
			],
			customCss: [
				'@fontsource-variable/geist',
				'@fontsource/geist-mono/400.css',
				'@fontsource/geist-mono/500.css',
				'@fontsource/geist-mono/600.css',
				// Tiempos-like serif used for headings in the Anthropic light theme.
				'@fontsource-variable/newsreader',
				'./src/styles/theme.css',
			],
			components: {
				SiteTitle: './src/components/SiteTitle.astro',
				SocialIcons: './src/components/SocialIcons.astro',
			},
			expressiveCode: {
				themes: ['github-dark', 'github-light'],
				themeCssSelector: (theme) =>
					theme.type === 'dark' ? '[data-theme="dark"]' : '[data-theme="light"]',
				styleOverrides: {
					borderRadius: '0px',
					borderColor: 'var(--ss-rule-strong)',
					codeFontFamily: "'Geist Mono', ui-monospace, monospace",
				},
			},
			sidebar: [
				{
					label: 'Get Started',
					items: [
						{ label: 'Introduction', slug: 'getting-started/introduction' },
						{ label: 'Quickstart', slug: 'getting-started/quickstart' },
						{ label: 'Installation', slug: 'getting-started/installation' },
						{ label: 'Your first workflow', slug: 'getting-started/your-first-workflow' },
					],
				},
				{
					label: 'Workflows',
					items: [
						{ label: 'Overview', slug: 'workflows/overview' },
						{ label: 'YAML schema', slug: 'workflows/yaml-schema' },
						{ label: 'Bundled workflows', slug: 'workflows/bundled' },
						{ label: 'Design-to-code', slug: 'workflows/design-to-code' },
						{ label: 'Writing custom workflows', slug: 'workflows/custom' },
						{ label: 'Isolation & worktrees', slug: 'workflows/isolation' },
						{ label: 'Channels (CLI / UI / Actions)', slug: 'workflows/channels' },
					],
				},
				{
					label: 'Specs',
					items: [
						{ label: 'Why specs', slug: 'specs/why-specs' },
						{ label: 'Writing specs', slug: 'specs/writing-specs' },
						{ label: 'Spec links & drift', slug: 'specs/links-and-drift' },
						{ label: 'The @implements pragma', slug: 'specs/implements-pragma' },
					],
				},
				{
					label: 'Graph',
					items: [
						{ label: 'How it works', slug: 'core-concepts/how-it-works' },
						{ label: 'The knowledge graph', slug: 'core-concepts/knowledge-graph' },
						{ label: 'Resolution & frameworks', slug: 'core-concepts/resolution' },
						{ label: 'Framework routes', slug: 'guides/framework-routes' },
						{ label: 'Affected tests in CI', slug: 'guides/affected-tests' },
						{ label: 'Indexing a project', slug: 'guides/indexing' },
					],
				},
				{
					label: 'Claude Code',
					items: [
						{ label: 'Overview', slug: 'claude-code/overview' },
						{ label: 'Sessions', slug: 'claude-code/sessions' },
						{ label: 'MCP servers', slug: 'claude-code/mcp' },
						{ label: 'Memory', slug: 'claude-code/memory' },
						{ label: 'Heatmap', slug: 'claude-code/heatmap' },
						{ label: 'Costs & cache', slug: 'claude-code/costs' },
						{ label: 'SpecShip Impact', slug: 'claude-code/specship-impact' },
						{ label: 'Tips engine', slug: 'claude-code/tips' },
					],
				},
				{
					label: 'Integrations',
					items: [
						{ label: 'JIRA', slug: 'guides/jira' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'MCP server', slug: 'reference/mcp-server' },
						{ label: 'CLI', slug: 'reference/cli' },
						{ label: 'Library API', slug: 'reference/api' },
						{ label: 'Languages', slug: 'reference/languages' },
						{ label: 'Configuration', slug: 'getting-started/configuration' },
					],
				},
				{ label: 'Troubleshooting', slug: 'troubleshooting' },
			],
		}),
	],
});
