# Vision

gsd-pi is the orchestration layer between you and AI coding agents. It handles planning, execution, verification, and shipping so you can focus on what to build, not how to wrangle the tools.

## Who it's for

Anyone who codes with AI agents — solo developers shipping faster, open-source maintainers handling scale, vibe coders who think in outcomes. gsd-pi adapts to skill level and workflow.

## Principles

**Extension-first.** If it can be an extension, it should be. Core stays lean. New capabilities belong in extensions, skills, and plugins unless they fundamentally require core integration.

**Simplicity over abstraction.** The codebase was aggressively cleaned up. Every line earns its place. Don't add helpers, utilities, or abstractions unless they eliminate real duplication or solve a real problem. Three similar lines of code is better than a premature abstraction.

**Tests are the contract.** If you change behavior, the tests tell you what you broke. Write tests for new behavior. Trust the test suite.

**Ship fast, fix fast.** Get it out, iterate quickly, don't let perfect be the enemy of good. Every release should work, but we'd rather ship and patch than delay and accumulate.

**Provider-agnostic.** gsd-pi works with any LLM provider. No architectural decisions should privilege one provider over another.

## What we won't accept

These save everyone time. Don't open PRs for:

- **Enterprise patterns.** Dependency injection containers, abstract factories, strategy-pattern-for-the-sake-of-it, over-engineered config systems. This is a CLI tool, not a Spring application.

- **Framework swaps.** Rewriting working code in a different library or framework without a clear, measurable improvement in performance or maintainability. "I prefer X" is not sufficient motivation.

- **Cosmetic refactors.** Renaming variables to your preferred style, reordering imports, reformatting code that works. This is pure churn that creates merge conflicts and review burden for zero user value.

- **Complexity without user value.** If a change adds abstraction, indirection, or configuration but doesn't improve something a user can see or feel, it doesn't belong here.

- **Heavy orchestration layers.** Don't duplicate what the agent infrastructure already provides. Build on top of it, don't wrap it.

## Why this project exists

gsd-pi is the community-driven continuation of the original GSD project under the [open-gsd](https://github.com/open-gsd) organization.

**What happened, briefly and honestly:** the original maintainer (TÂCHES, GitHub `glittercowboy`) stopped responding to the open-source community around 2026-04-01, and the repositories went unmaintained. In May 2026 a related `$GSD` token — launched after the project won a hackathon — collapsed: the founder withdrew liquidity, sold their holdings, and deleted their public accounts on or around 2026-05-22. The event has been widely and publicly characterized as a rug-pull, and supporters lost money. The farewell message claimed the project had been rendered "obsolete" by Claude Code and Codex — an explanation the community largely regards as a cover story. With the original repositories abandoned and the maintainer gone, the community continues the work here instead. See [The Promise](https://www.opengsd.net/promise) for the fuller story.

Rather than walking away, we're rebuilding in the open — with a different approach and a clear set of commitments.

What that means for this project:

- **Transparency.** We build in public and communicate honestly, even when the news isn't good.
- **Accountability.** Maintainers stay present and accessible to the community.
- **Sustainable focus.** We prioritize long-term utility over short-term excitement.
- **Collective ownership.** This is something bigger than one person. Contributors share the work and the direction.
- **Honesty about the past.** We acknowledge the harm that was done rather than erase it.

Active development, new features, and architectural investment all happen here. The v1 line continues separately as the community-maintained [get-shit-done-redux](https://github.com/open-gsd/get-shit-done-redux).
