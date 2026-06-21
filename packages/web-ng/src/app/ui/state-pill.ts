import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Icon } from '../shell/icon/icon';
import { STATE, STATE_ICON, type StateConfig } from './state';

/**
 * State pill — coloured label for spec-link / workflow-run states.
 * Mirrors design ui.jsx StatePill: optional pulse animation + leading dot or icon.
 */
@Component({
  selector: 'app-state-pill',
  imports: [Icon],
  template: `<span
    class="pill"
    [style.color]="cfg().color"
    [style.background]="cfg().bg"
    [style.animation]="pulse() ? 'pulsePill 600ms ease-out' : null"
  >
    @if (withDot()) {
      <span class="pill-dot" [style.background]="cfg().color"></span>
    } @else if (icon()) {
      <app-icon [name]="icon()!" [size]="11" />
    }
    {{ cfg().label }}
  </span>`,
  styles: [':host{display:inline-flex;}'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatePill {
  readonly state = input.required<string>();
  readonly pulse = input(false);
  readonly withDot = input(false);

  protected readonly cfg = computed<StateConfig>(() => STATE[this.state()] ?? STATE['info']);
  protected readonly icon = computed<string | undefined>(() =>
    this.withDot() ? undefined : STATE_ICON[this.state()],
  );
}
