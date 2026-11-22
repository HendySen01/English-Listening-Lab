---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance.
metadata:
  author: vercel
  version: "1.1.0"
---

# Web Interface Guidelines

The review rules were read from the pinned upstream file:

https://github.com/vercel-labs/web-interface-guidelines/blob/434b7f91364665f2f733b310ec54809bf8f37937/command.md

Git clone of vercel-labs/agent-skills failed to connect on 2026-11-22. This local copy records the rules that were applied to the English Listening Lab interface.

Applied checks:

- Buttons keep readable text on hover, active, and disabled.
- Focus uses :focus-visible with a 2px outline, not outline:none.
- Icon-only controls are avoided; Lucide icons are aria-hidden beside text.
- Primary actions are button elements. Navigation uses router links.
- Transitions list background, border, and color. They do not use transition:all.
- prefers-reduced-motion removes those transitions.
- color-scheme is set for light and dark.
- Loading copy ends with an ellipsis.
- English words that must not be translated use translate="no".
- A skip link points at the main content.
