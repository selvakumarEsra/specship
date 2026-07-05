/**
 * REQ-DESKTOP-019 A3 — global shortcuts: ⌘/Ctrl 1–7 jumps to the first seven
 * nav pages, g-chords (g g / g s / g d) navigate, and both are suppressed
 * while focus is in an editable field. ⌘K toggles the palette from anywhere,
 * including editables.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlobalShortcuts } from '../hooks';

const JUMP_IDS = ['dashboard', 'graph', 'specs', 'drift', 'runs', 'sessions', 'heatmap'];

function Probe({ onToggle = () => {} }: { onToggle?: () => void }) {
  useGlobalShortcuts({ onTogglePalette: onToggle, pageIds: JUMP_IDS });
  return (
    <div>
      <input data-testid="field" />
      <textarea data-testid="area" />
      <div data-testid="editor" contentEditable="true" />
    </div>
  );
}

beforeEach(() => {
  history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
});

describe('useGlobalShortcuts (REQ-DESKTOP-019)', () => {
  it('⌘/Ctrl 1–7 jumps to the first seven nav pages', () => {
    render(<Probe />);
    fireEvent.keyDown(window, { key: '2', metaKey: true });
    expect(location.pathname).toBe('/graph');
    fireEvent.keyDown(window, { key: '7', ctrlKey: true });
    expect(location.pathname).toBe('/heatmap');
    // Keys past the mapped seven do nothing.
    fireEvent.keyDown(window, { key: '9', metaKey: true });
    expect(location.pathname).toBe('/heatmap');
  });

  it('g g / g s / g d chords navigate to Graph, Specs, and Drift', () => {
    render(<Probe />);
    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'g' });
    expect(location.pathname).toBe('/graph');
    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 's' });
    expect(location.pathname).toBe('/specs');
    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'd' });
    expect(location.pathname).toBe('/drift');
  });

  it('an armed chord expires after the window instead of firing late', () => {
    vi.useFakeTimers();
    try {
      render(<Probe />);
      fireEvent.keyDown(window, { key: 'g' });
      vi.advanceTimersByTime(1100);
      fireEvent.keyDown(window, { key: 's' }); // chord expired — must not navigate
      expect(location.pathname).toBe('/');
    } finally {
      vi.useRealTimers();
    }
  });

  it('A3: chords and number jumps never fire from input, textarea, or contentEditable', () => {
    render(<Probe />);
    for (const id of ['field', 'area', 'editor']) {
      const el = screen.getByTestId(id);
      fireEvent.keyDown(el, { key: 'g' });
      fireEvent.keyDown(el, { key: 'g' });
      fireEvent.keyDown(el, { key: '2', metaKey: true });
      expect(location.pathname).toBe('/');
    }
  });

  it('typing g in an editable does not arm a chord that a later bare key completes', () => {
    render(<Probe />);
    fireEvent.keyDown(screen.getByTestId('field'), { key: 'g' });
    fireEvent.keyDown(window, { key: 'g' }); // first bare g only ARMS — no nav yet
    expect(location.pathname).toBe('/');
  });

  it('⌘K toggles the palette everywhere, including editable fields', () => {
    const onToggle = vi.fn();
    render(<Probe onToggle={onToggle} />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.keyDown(screen.getByTestId('field'), { key: 'k', ctrlKey: true });
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});
