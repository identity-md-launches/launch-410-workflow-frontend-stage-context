# Referral design system

## Overview

Referral is a one-page Sepolia trading and referral interface. Its audience needs to see trade amounts, understand referral fees and claim rewards without navigating away. The implemented direction uses a warm neutral page, restrained green accent, white transactional surfaces and an editorial serif treatment for the referral feature. This direction was inferred for this assignment.

Source: `web/src/styles.css` defines the shared system; `web/src/App.tsx` composes the page. The desktop swap panel sits beside referral creation and earnings. On smaller screens these follow the same DOM order in a single column. The hero is specific to this page, not a required layout for future pages.

This document is under `docs/` because the assignment's overriding path rules prohibit root `DESIGN.md`.

## Colors

All values are sRGB hex. Primitives are mapped to semantic roles in `web/src/styles.css:1`; use the semantic token in components.

| Role | Token | Value |
| --- | --- | --- |
| Page background | `--color-bg` | `#f5f4ef` |
| Card/input surface | `--color-surface` | `#ffffff` |
| Recessed/disabled surface | `--color-soft` | `#eeeee7` |
| Main text | `--color-text` | `#202a25` |
| Secondary text | `--color-muted` | `#59665e` |
| Structural borders | `--color-border` | `#c8cec6` |
| Primary action | `--color-accent` | `#365b35` |
| Primary hover | `--color-accent-hover` | `#29492a` |
| Inverse action text | `--color-inverse` | `#ffffff` |
| Referral feature surface | `--color-feature` | `#e4edda` |
| Feature icon/token surface | `--color-feature-symbol` | `#d2e5bb` |
| Error text / surface | `--color-error` / `--color-error-bg` | `#9b3528` / `#fff1ed` |
| Focus indicator | `--color-focus` | `#344cb2` |

Measured in Chromium: muted text on page 5.47:1, main text on feature surface 12.28:1, primary white text on green 7.76:1. The same muted/page pair is used for eyebrows. These measurements cover the named opaque pairs, not every possible state. Axe additionally scanned four viewport states. There is one light theme; no dark theme is implemented.

## Typography

The body stack is `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. There is no downloaded Inter file: the system fallback is intentional and there are no font-network requests. Georgia / Times New Roman / serif supplies the referral heading and large percentage. The logo is inline SVG plus text, and the favicon is a local SVG.

Body base: 16px, line-height 1.55, normal weight. Small UI text: `.8125rem`; secondary captions and dense row metadata range from `.6875rem` to `.75rem`. Form inputs remain 16px or larger. H1 uses `clamp(2.65rem, 5vw, 4.15rem)`, line-height 1.07, weight 500 and -0.065em tracking. H2 uses 1.3rem, line-height 1.3 and weight 650. The serif referral heading uses 1.7rem, weight 400. Headings use balanced wrapping; paragraphs use pretty wrapping and constrained measure.

Amounts and changing statistics use tabular numerals. Amount entry is 2rem, estimated output 1.75rem, and claimable balance 2.8rem. Very small nonzero amounts display `<0.00000001`; full minimum-output precision remains visible, and claim values have a full-value title. Long addresses wrap where shown as text; readonly link inputs allow selection and horizontal editing-field scrolling. No external font assets or font preload is required. Native system fonts can vary by platform.

## Layout

`.wrap` sets a maximum width of 1168px with 32px inline padding. Spacing follows an 8px base with 16/24/28/32px grouping and 64px hero separation. Cards use 28px padding and a 24px desktop grid gap. `.dashboard` has equal columns; `.right-column` stacks link and earnings cards. `.pool-strip` uses four columns, and `.details-section` uses two. Controls have at least 44px height. Nothing is fixed over the scrolling content.

Breakpoints from the final stylesheet:

- At 58rem: wrap padding becomes 24px, card padding 22px, dashboard gaps 16px, compact link entry stacks, pool facts use two columns.
- At 43rem: dashboard becomes one column, wrap padding becomes 20px, hero percentage aside and redundant header tagline/network badge are hidden, details stack, and event rows wrap. The testnet warning remains in the page's trade copy and footer. Wallet controls stay accessible.
- At 23rem: wrap padding becomes 16px, card padding 18px, referral address/button stack, small section headers wrap and amount/earnings sizes reduce.

Desktop 1440, intermediate 800, mobile 390 and narrow 320 CSS pixels were rendered and inspected with no horizontal document overflow. 200% root text enlargement was checked separately; this is not native browser zoom. Logical padding/margin/border properties support flow consistency, but RTL and localization are not implemented or validated.

## Elevation & Depth

Surfaces are deliberately flat. Borders communicate grouping and field boundaries; there are no decorative shadows, gradients, modal overlays or floating chrome. Selected segmented controls get a white surface and visible border. The referral panel uses a tonal background to distinguish sharing from trading.

## Shapes

Cards use `--radius: 20px`; inset grouped fields and empty states use 12px; buttons use 10px; inputs and segmented buttons use 8px. Pills use 6px; token and activity markers are circular. Inputs have 1px structural borders. These are component-specific shapes, not a new external component library.

## Components

Patterns are composed in `web/src/App.tsx`; CSS classes below are reusable even where no separately exported React component exists.

| Pattern | Classes / component | Behavior |
| --- | --- | --- |
| Brand | `Mark`, `.brand`, `.footer-brand` | Decorative SVG with text; header link has an accessible name. |
| Primary action | `.primary.full` | Filled green, full-width transaction-flow action; explicit disabled/loading states. |
| Secondary actions | `.outline`, `.dark-button`, `.text-button` | Claim outline, neutral dark sharing action, text refresh/dismiss action. |
| Swap direction | `.segmented` | Native buttons with `aria-pressed`, keyboard activation and visible selected state. |
| Amount entry/output | `.amount-box`, `.amount-row`, `.currency` | Persistent labels, decimal keyboard, distinct output and unit markers. |
| Referral form | `.link-card`, `.link-entry`, `.generated-link` | Address validation, use-wallet shortcut, readonly selectable result, clipboard fallback. |
| Earnings | `.earnings-card`, `.earnings-stats` | Loading/unconnected em dashes, lifetime stats, complete balance claim, empty guidance. |
| State feedback | `.notice`, `.error`, `.action-feedback` | Wrong-network switch, recoverable alerts, stable polite status region and transaction explorer link. |
| Activity | `.activity-list`, `.empty-state` | Recent onchain events, explicit bounded window, empty/error/loading states. |
| Disclosure | native `details` / `summary` | Contract addresses and economics; standard keyboard behavior, no modal focus trap. |

All interactive controls use a 3px focus outline with a 4px offset. Forced-colors mode uses `Highlight`, and selected tabs retain a border. Hover styles are gated to hover-capable devices. Only background color and transform transition, for 120ms ease-out, and only with `prefers-reduced-motion: no-preference`; active buttons scale to 0.96. Reduced motion removes those transitions. No page entrance animation or autoplay exists.

## Do's and Don'ts

- Reuse `.wrap`, `.card`, the semantic colors and native elements for new content. Keep secondary descriptions inside the existing measure.
- Preserve one green primary action within the transaction flow, explicit units and readable minimum output. Do not hide approvals in the swap confirmation.
- Keep errors next to their fields and focus the invalid field before entering a pending state. Keep network/verification prerequisites on consequential controls.
- Keep long addresses selectable and use explorer links for full context. Do not substitute decorative charts or invented activity for contract data.
- A new section should start with a heading, reuse the card/row spacing and collapse in DOM order. A second route would need an explicit static export or hash routing; do not introduce server rewrites.

Design guidance was applied from the pinned Better Interface reference (Jakub Krehel, MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`). Documentation structure was adapted from Impeccable (Paul Bakaus, Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`). See `docs/frontend/VALIDATION.md` for findings and coverage limits.
