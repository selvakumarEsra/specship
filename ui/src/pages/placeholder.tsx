import { Empty } from '../components/ui';

/**
 * Screens contracted by later REQ-DESKTOP requirements (sessions, heatmap,
 * costs, …) that this module ships the frame for but not yet the content.
 */
export function PlaceholderPage({ title, req }: { title: string; req?: string }) {
  return (
    <Empty
      icon="box"
      title={title}
      body={req ? `This screen lands with ${req}. The SSR dashboard still serves it today.` : 'This screen is not wired yet.'}
    />
  );
}
