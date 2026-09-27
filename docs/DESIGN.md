# Gas Tax design

## Overview

Gas Tax is a compact testnet tool for people exploring gas-price-dependent Uniswap v4 hook fees. The page uses warm neutral surfaces, dark typography, a bright lime primary action, and muted green fee/donation surfaces. The visual direction was inferred from the experiment's purpose, not supplied as a brand system.

The page hierarchy is introduction → live-state strip → gas monitor / tier preview / donation and swap → fee history → explanation and contract provenance. Product controls precede implementation details. Source: `web/src/App.tsx`, `web/src/style.css`. This document is under `docs/` because the explicit assignment path budget prohibits root `DESIGN.md`.

## Colors

`web/src/style.css:2` defines hex primitives and semantic aliases. Components use the aliases.

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#f5f4ef` | Page background |
| `--surface` | `#fbfaf7` | Panels, inputs, secondary buttons |
| `--surface-inset` | `#eeeee7` | Output estimates, segmented control, supporting notes |
| `--border` | `#dedfd4` | Structural separators and panels |
| `--input-border` | `#888b7d` | Interactive field / button boundaries |
| `--ink` | `#262923` | Primary text and dark wallet control |
| `--muted` | `#606357` | Supporting labels and explanatory text |
| `--accent` / `--accent-text` | `#d6ff5f` / `#262923` | Current primary swap action |
| `--reward-bg` / `--success` | `#eaf2d8` / `#385126` | Standard fee tier, donation surface, live-state dot |
| `--warning-bg` / `--warning-text` | `#fff0d9` / `#855000` | High tier and wrong-chain notices |
| `--error-bg` / `--error-text` | `#fff0ed` / `#a32d20` | Recoverable errors and invalid fields |
| `--focus` | `#46662b` | Keyboard focus indicator |

Text accompanies every status color. Only the next primary swap action receives the bright lime fill. The standard-tier green and high-tier amber encode states. There is one light theme; no dark theme or unused palette is implemented.

Measured rendered pairs are in `docs/frontend/contrast.json`: primary text/page 13.39:1; muted text/panel 5.88:1; primary button 12.87:1; standard tier 7.67:1; high-tier badge 5.95:1; router note 5.27:1. The observed input focus ring is 6.30:1 against its surface and input boundary is 3.33:1. These measurements cover the listed pairs, not every possible state.

## Typography

`web/src/typography.css` loads a local variable **DM Sans** WOFF2, 100–1000 normal weight, with `font-display: swap`. The implemented UI uses weights 400, 500, 600 and 700. The browser font check passed. Fallbacks are `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `sans-serif`. Numeric provenance uses `SFMono-Regular`, `Consolas`, `Liberation Mono`, `monospace`. The font's OFL notice is in `docs/frontend/FONT-LICENSE.txt` and the static export’s `licenses/DM-Sans-OFL.txt`.

Root text is 16px / 1.5. The main heading is `clamp(2.5rem, 4.8vw, 4.1rem)`, weight 500, line-height 1.15, tracking −0.055em. Panel headings are generally 1.15rem / 1.15 at weight 600; the swap heading is 23px at weight 500, and activity heading 24px. Metric values are approximately 26–34px, fee-preview values 49px (42px on small screens), and swap amounts 28–30px. Product descriptions are 12–16px, with 10–11px used for dense metadata, event badges and footnotes. Currency and provenance numbers use tabular figures. Inputs remain at least 16px; the gas input is 20px and amount input 30px (26px on mobile).

Headings use balanced wrapping; descriptions use pretty wrapping. Long IDs remain selectable and wrap in the provenance disclosure. Shortened addresses link to their complete explorer records; full deployed addresses and pool ID are also disclosed locally. Explanation text is capped at 65ch.

## Layout

The content width token is 1180px. The outer shell uses an 80px total gutter, reduced to 48px at 1050px and 32px at 520px. Desktop dashboard columns are `minmax(0, 1.5fr) minmax(350px, 1fr)`, with 24px between columns. At 1050px they become `1.25fr` and a minimum 320px right column, with a 20px gap. At 810px the layout becomes one column, preserving DOM reading and keyboard order. The monitor column contains sections 01–03 before the swap section. Navigation links hide at 810px; all sections remain in the document. The decorative stepped graphic and header network label hide at 520px.

Panel padding is 26px (swap 28px), then 22px at 1050px and 20px at 520px. Related elements use 4–12px gaps; component groups use 16–32px. No sticky overlay blocks content. Controls stay inset from viewport edges. Two-column metrics stay paired on mobile, while the preview input and result stack at 520px. The explanation changes from three columns to two at 810px, then one at 520px.

The activity table scrolls inside `.table-wrap`; page-level horizontal overflow is forbidden. A positioned table wrapper keeps hidden external-link labels within its scrolling region. The table's region is keyboard focusable and named with scrolling instructions. Actual export widths checked: 1440, 900, 810, 390 and 320 CSS pixels. These are viewport/reflow checks, not browser-native zoom or physical-device tests.

## Elevation & Depth

The system is mostly flat. Panel borders establish structure. The swap panel alone uses two faint shadows (`0 4px 8px #26292303`, `0 12px 30px #26292304`) to make the action area distinct. The selected direction button uses a small shadow. The direction arrow overlaps input/output fields in normal flow. There are no dialogs, drawers, portals or sticky layers.

## Shapes

`--radius-panel` is 18px, reduced to 14px on small screens. `--radius-control` is 9px. Token fields use 12px radii, a segmented tray 10px with 7px internal buttons, compact badges 5px, and notices 10px. Round currency marks and a geometric inline SVG lightning mark provide the only illustration system. No raster artwork is required.

## Components

The implemented patterns live in `web/src/App.tsx` and shared CSS, not a separate component library:

- `External`: normal anchor, new-tab hint in its accessible text, and a decorative arrow. `Bolt` and `Arrow` are decorative icon helpers.
- `.button`: neutral, `.dark`, `.primary`, `.compact`, and `.full`. Disabled states retain readable labels. Press feedback is a 0.96 scale with a 120ms transition only under `prefers-reduced-motion: no-preference`; reduced-motion controls have no transition. Hover effects are restricted to hover-capable pointers.
- `.panel` / `.section-heading` / `.section-index`: consistent section grouping and a small numbered marker. `.donation-panel` uses the reward surface.
- `.input-unit`, `.token-field`, `.small-input`: persistent native labels, unit suffixes, decimal keyboards, and explicit field errors. Invalid form submission focuses the relevant field. Values and status changes remain readable with the keyboard.
- `.segmented`: two native buttons with `aria-pressed`, for buy/sell state. No custom tab interaction model.
- `.tier-result` and `.badge`: text labels distinguish standard/high states in addition to color.
- Native `details`/`summary`: disclose hook data, price limit and deployment provenance. No custom focus trap is needed.
- `.notice`, persistent `[role=status]`, and transaction links: loading, wrong-chain, errors, submission and confirmation feedback. Errors use `role=alert`; unrelated successes use the stable polite region.
- `.table-wrap`, native `table`, `.empty`: accessible event headings, explicit empty/filter/error states, and horizontal scrolling within the activity section.

Global `:focus-visible` uses a 3px outline with 4px offset. Forced colors substitute `Highlight`. Buttons are generally at least 46px high; compact wallet and disclosure controls are 42px. A first-focusable skip link reaches the main landmark.

## Do's and Don'ts

Reuse semantic color tokens and `.panel`/`.section-heading` for another section. Put a persistent label on each form field, keep units next to values, use tabular digits for changing numbers, and provide an inline recovery path for errors. Add disclosures with native `details` instead of inventing a modal.

Keep the next swap action as the bright primary control. Preserve transaction prerequisites and the router-limit explanation. Do not turn projected output into a promised minimum, identify an event router as the trader, fabricate missing live metrics, or move mobile sections out of DOM reading order. Extend the current light system only when a new requirement justifies it.

Design principles: Jakub Krehel's Better Interface, MIT, pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`. Documentation method: Paul Bakaus's Impeccable, Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. See `docs/frontend/NOTICE.md` and the consolidated validation report for coverage and limitations.
