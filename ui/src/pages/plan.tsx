/**
 * Plan screen (REQ-DASHSIMPLE-003) — epic → story → task as a distraction-free
 * reader, like a browser's reading mode. One capped column, document
 * typography, no side panels; the only chrome is the level toggle and the
 * filter above the column.
 *
 * Epics come from each spec document's `epicKey` (documents sharing a key
 * merge, a document without one is its own group); stories are requirements;
 * tasks are acceptance criteria with their test-evidence verdict. A story's
 * status is Review's own classification (review-groups.ts), so the two screens
 * never disagree. A JIRA key links out only when a base URL is configured —
 * the dashboard never calls JIRA.
 */
import { useMemo, useState, type MouseEvent } from 'react';
import { api, isNoProject, type CoverageVerdict, type DriftLink, type PlanEpic, type PlanResponse, type PlanStory, type PlanTask } from '../api';
import { useApi } from '../hooks';
import { go } from '../router';
import { getPlanLevel, setPlanLevel, type PlanLevel } from '../prefs';
import { classifyRequirement, type ReviewGroup } from '../review-groups';
import { Button, Empty, ErrorState, PageHead, Pill, Segmented, StatePill } from '../components/ui';
import type { PageProps } from './types';

const LEVELS: Array<{ value: PlanLevel; label: string }> = [
  { value: 'epics', label: 'Epics only' },
  { value: 'stories', label: 'Epics + stories' },
  { value: 'all', label: 'Everything' },
];

const isLevel = (v: string): v is PlanLevel => LEVELS.some((l) => l.value === v);

/** A story's status — exactly the group Review puts the requirement in. */
export function storyStatus(story: PlanStory, driftLinks: DriftLink[]): ReviewGroup {
  return story.coverage ? classifyRequirement(story.coverage, driftLinks).group : 'pending';
}

/** Keep what matches the filter: a matching epic or story keeps all it holds. */
function filterEpics(epics: PlanEpic[], needle: string): PlanEpic[] {
  const n = needle.trim().toLowerCase();
  if (!n) return epics;
  const hit = (s: string | null | undefined) => (s ?? '').toLowerCase().includes(n);
  const out: PlanEpic[] = [];
  for (const e of epics) {
    if (hit(e.title) || hit(e.key)) { out.push(e); continue; }
    const docs = e.docs
      .map((d) => ({
        ...d,
        stories: d.stories.flatMap((s) => {
          if (hit(s.title) || hit(s.specId)) return [s];
          const tasks = s.tasks.filter((t) => hit(t.title) || hit(t.specId));
          return tasks.length ? [{ ...s, tasks }] : [];
        }),
      }))
      .filter((d) => d.stories.length > 0);
    if (docs.length) out.push({ ...e, docs });
  }
  return out;
}

function reviewHref(specId: string): string {
  return '/review/' + encodeURIComponent(specId);
}

function openInReview(e: MouseEvent<HTMLAnchorElement>, specId: string): void {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  go('review', { param: specId });
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// @implements REQ-DASHSIMPLE-003
export function PlanPage({ project }: PageProps) {
  const planQ = useApi(() => api.specPlan(project), [project]);
  const [level, setLevel] = useState<PlanLevel>(() => getPlanLevel());
  const [filter, setFilter] = useState('');

  const pickLevel = (v: string) => {
    if (!isLevel(v)) return;
    setLevel(v);
    setPlanLevel(v);
  };

  const shown = useMemo(() => filterEpics(planQ.data?.epics ?? [], filter), [planQ.data, filter]);

  if (isNoProject(planQ.error)) {
    return <Empty icon="folder" title="No project selected" body="Pick an indexed project from the switcher in the status strip." />;
  }
  if (planQ.error) {
    return (
      <ErrorState
        title="Couldn’t load the plan"
        detail={errorText(planQ.error)}
        action={<Button variant="primary" size="sm" onClick={() => planQ.reload()}>Retry</Button>}
      />
    );
  }
  if (!planQ.data) return <Empty icon="refresh" title="Loading the plan…" />;

  const stories = planQ.data.epics.reduce((n, e) => n + e.docs.reduce((m, d) => m + d.stories.length, 0), 0);
  if (!planQ.data.epics.length || !stories) {
    return <Empty icon="book" title="No plan yet" body="Author a spec under specs/ — its requirements show here once it is indexed." />;
  }

  return (
    <div className="scroll-y" style={{ flex: 1, minHeight: 0 }}>
      <div style={{ padding: 'var(--space-lg) var(--space-lg) 0' }}>
        <PageHead
          icon="book"
          title="Plan"
          sub={`${planQ.data.epics.length} epics · ${stories} stories`}
          actions={(
            <div className="row gap-8">
              <Segmented options={LEVELS} value={level} onChange={pickLevel} size="sm" label="Plan depth" />
              <input
                className="input"
                type="search"
                aria-label="Filter the plan"
                placeholder="Filter epics, stories, tasks…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          )}
        />
      </div>
      {shown.length === 0
        ? <Empty icon="search" title="Nothing matches the filter" />
        : <PlanReader plan={planQ.data} epics={shown} level={level} />}
    </div>
  );
}

/** The reading column — content only, nothing beside it (A5). */
// @implements REQ-DASHSIMPLE-003
export function PlanReader({ plan, epics, level }: { plan: PlanResponse; epics: PlanEpic[]; level: PlanLevel }) {
  return (
    <article className="plan-reader" data-testid="plan-reader" data-level={level}>
      {epics.map((e) => (
        <EpicSection key={(e.key ?? '') + e.title} epic={e} plan={plan} level={level} />
      ))}
    </article>
  );
}

function EpicSection({ epic, plan, level }: { epic: PlanEpic; plan: PlanResponse; level: PlanLevel }) {
  const count = epic.docs.reduce((n, d) => n + d.stories.length, 0);
  return (
    <section data-plan-epic={epic.key ?? epic.title}>
      <h2>
        {epic.title}
        {epic.key && <> <JiraKey jiraKey={epic.key} baseUrl={plan.jiraBaseUrl} /></>}
      </h2>
      {level === 'epics' ? (
        <p className="muted">{count} {count === 1 ? 'story' : 'stories'}</p>
      ) : epic.docs.map((d) => (
        <div key={d.id} data-plan-doc={d.id}>
          {epic.docs.length > 1 && <p className="eyebrow">{d.title}</p>}
          {d.stories.map((s) => (
            <StorySection key={s.specId} story={s} plan={plan} showTasks={level === 'all'} />
          ))}
        </div>
      ))}
    </section>
  );
}

function StorySection({ story, plan, showTasks }: { story: PlanStory; plan: PlanResponse; showTasks: boolean }) {
  const status = storyStatus(story, plan.driftLinks);
  return (
    <section data-plan-story={story.specId} data-status={status}>
      <h3>
        <a href={reviewHref(story.specId)} onClick={(e) => openInReview(e, story.specId)}>{story.title}</a>
      </h3>
      <p className="row gap-6" style={{ flexWrap: 'wrap', fontSize: 'var(--fs-sm)' }}>
        <StatePill state={status} />
        <span className="mono muted">{story.specId}</span>
        {story.jiraKey && <JiraKey jiraKey={story.jiraKey} baseUrl={plan.jiraBaseUrl} />}
      </p>
      {showTasks && (
        <>
          {story.body.trim() && <p>{story.body.trim()}</p>}
          {story.tasks.length > 0 && (
            <ul aria-label={'Tasks of ' + story.specId}>
              {story.tasks.map((t) => <TaskItem key={t.specId} task={t} />)}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

const VERDICT_PILL: Record<CoverageVerdict, { color?: string; bg?: string }> = {
  untested: {},
  tested: { color: 'var(--info)', bg: 'var(--info-soft)' },
  verified: { color: 'var(--accent)', bg: 'var(--accent-soft)' },
  broken: { color: 'var(--danger)', bg: 'var(--danger-soft)' },
};

function TaskItem({ task }: { task: PlanTask }) {
  const tone = VERDICT_PILL[task.verdict] ?? {};
  return (
    <li data-plan-task={task.specId} data-verdict={task.verdict}>
      <a href={reviewHref(task.specId)} onClick={(e) => openInReview(e, task.specId)}>{task.title}</a>{' '}
      <Pill color={tone.color} bg={tone.bg}>{task.verdict}</Pill>
    </li>
  );
}

/** A JIRA key: a link when a base URL is configured, plain text otherwise (A4). */
// @implements REQ-DASHSIMPLE-003
export function JiraKey({ jiraKey, baseUrl }: { jiraKey: string; baseUrl: string | null }) {
  if (!baseUrl) return <span className="mono" data-jira-key={jiraKey}>{jiraKey}</span>;
  return (
    <a
      className="mono"
      data-jira-key={jiraKey}
      href={`${baseUrl}/browse/${encodeURIComponent(jiraKey)}`}
      target="_blank"
      rel="noreferrer noopener"
    >
      {jiraKey}
    </a>
  );
}
