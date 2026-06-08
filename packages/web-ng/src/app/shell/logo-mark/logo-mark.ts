import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-logo-mark',
  template: `<svg
    [attr.width]="size()"
    [attr.height]="size()"
    viewBox="0 0 32 32"
    fill="none"
    [style.filter]="glow() ? 'drop-shadow(0 0 9px rgba(91,147,242,0.35))' : 'none'"
    style="flex-shrink:0;"
  >
    <defs>
      <linearGradient id="ssTile" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop stop-color="#12161E" />
        <stop offset="1" stop-color="#0B0D11" />
      </linearGradient>
      <linearGradient id="ssLead" x1="18" y1="11" x2="26" y2="21" gradientUnits="userSpaceOnUse">
        <stop stop-color="#6FA0F6" />
        <stop offset="1" stop-color="#5B93F2" />
      </linearGradient>
    </defs>
    @if (tile()) {
      <rect width="32" height="32" rx="7.2" fill="url(#ssTile)" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="6.7" fill="none" stroke="rgba(255,255,255,0.08)" />
    }
    <g transform="translate(4.6 4.6) scale(0.715)">
      <path d="M5 16 H11 M11 9 L23 16 L11 23" stroke="rgba(150,165,200,0.5)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none" />
      <line x1="11" y1="9" x2="11" y2="23" stroke="rgba(150,165,200,0.4)" stroke-width="1.9" stroke-linecap="round" />
      <circle cx="23" cy="16" r="3.6" fill="url(#ssLead)" />
      <circle cx="11" cy="9" r="2.9" fill="#A586F5" />
      <circle cx="11" cy="23" r="2.9" fill="#46C26B" />
      <circle cx="5" cy="16" r="2.1" fill="#29D2BE" />
    </g>
  </svg>`,
  styles: [`:host{display:inline-flex;align-items:center;justify-content:center;line-height:0;}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogoMark {
  readonly size = input(24);
  readonly tile = input(true);
  readonly glow = input(true);
}
