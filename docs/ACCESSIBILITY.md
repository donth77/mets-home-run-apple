# Accessibility

Virtual Apple targets a usable WCAG 2.2 AA experience; this document is an implementation and test record, not a certification. Apple Lab retains keyboard and semantic basics, but it is a single-operator engineering tool and is not the public accessibility release target.

## Implemented behavior

- A skip link moves keyboard focus to the visible game-status card.
- Focus indicators remain visible on links, buttons, and the status target.
- The compact HTML scorebug provides text for score, inning, count, bases, outs, final state, and the active Mets matchup; the Three.js board is complementary scene artwork.
- A visually hidden, polite live region announces only meaningful score/inning/outs and phase changes. Pitch-level descriptions remain visible without being repeatedly announced.
- Team-color score rows darken colors until white text reaches at least 4.5:1 contrast.
- Layout rules keep the line score and compact scorebug from overlapping on narrow screens.
- `prefers-reduced-motion`, increased-contrast, and forced-colors modes receive explicit styles. Celebration confetti is omitted for reduced motion.
- Scene audio and live radio are opt-in. Controls expose pressed/playing state, playback errors as text, and an official provider link. Live radio has no synchronized caption track; the page does not claim one.
- Decorative scene and logo elements do not add redundant accessible names.

## Automated coverage

The Virtual Apple accessibility suite runs `axe-core` against the default between-games view and the live, home-run, review, rain-delay, Mets-win, and offseason presentations. Happy DOM has no layout or color engine, so automated contrast is disabled in that scan and covered separately by deterministic team-color tests.

Run:

```bash
pnpm --filter @apple/virtual-apple test
pnpm --filter @apple/scoreboard-ui test
pnpm lint
pnpm typecheck
```

## Manual release checks

Automated checks cannot verify the rendered Three.js scene or responsive geometry. Before a public release, check Virtual Apple in current desktop and mobile browsers:

1. Navigate every action with keyboard only; confirm the skip link, focus order, and visible focus rings.
2. Test at 200% browser zoom and at 320 CSS pixels wide; confirm scoreboards, radio, schedule, Gameday, status, and local demo controls do not overlap or clip.
3. Enable reduced motion and confirm no confetti, no essential animation-only information, and a usable raised/lowered state.
4. Enable forced colors/high contrast and confirm controls and status boundaries remain distinguishable.
5. With a screen reader, verify one concise update for score/inning/outs or a major phase change, not one announcement per pitch.
6. Confirm sound starts only after a user action, can be stopped immediately, and errors remain readable without audio.
7. Confirm the scene loading overlay covers the unfinished 3D model and exposes no flashing transition.

Record browser, viewport, assistive technology, and any accepted exceptions with the release notes.
