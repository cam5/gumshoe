# gumshoe

gumshoe builds and tests an agent. The agent clones a web page from a live URL. The agent does not copy pixels. The agent writes new, clean front-end code instead.

## The Three Tools

The agent can call three helper tools during a clone task.

- **red-twine** reads raw HTML. It finds markup that repeats across a page or a site. It flags markup that looks like a real, reusable component.
- **windtailor** opens a live web page in a browser. It reads one element's real, rendered style. It turns that style into Tailwind CSS classes and matching design tokens.
- **slowcure** reads a web page two ways: once as raw HTML, once after JavaScript runs. It reports the parts of the page that differ between the two reads.

## The Problem

We wrote a first prompt for the agent. We do not yet know two things:

1. Does the prompt guide the agent to good decisions?
2. Do the three tools help the agent more than a plain agent with no tools?

This repo answers both questions with a repeatable test system.

## Key Terms

- **fixture** — a small, self-contained HTML page. Each fixture forces one agent decision, such as "build a component here" or "flag this part as too hard to clone."
- **tier** — one layer of the test system. Each tier checks a different part of the agent's work.
- **tooled run** — an agent run where the agent may call red-twine, windtailor, and slowcure.
- **baseline run** — an agent run on the same fixture, with the same prompt frame, but with no access to the three tools.

## Fixtures

We store each fixture under `fixtures/`. We build our own fixtures first. We add real websites only after the agent performs well on our own fixtures.

## Test Tiers

### Tier 0 — Tool Contract Snapshots

Tier 0 runs the raw command-line tools against each fixture. It does not run the agent. It compares each tool's JSON output against a saved snapshot. A failed Tier 0 test means a tool's output changed. It does not mean the agent's prompt is wrong.

### Tier 1 — Agent Trajectory Checks

Tier 1 runs the agent against a fixture. It records every tool call the agent makes, in order. It checks this call list against a manifest for that fixture. The manifest states the calls we expect the agent to make. Most Tier 1 checks need no model judge. A model judge grades only the fixtures where a human would call the right answer unclear.

### Tier 2 — Outcome Checks

Tier 2 grades the page the agent builds at the end of a run. It compares a screenshot of the agent's page against a screenshot of the fixture. It also asks a model judge to grade the code itself, such as reuse of design tokens.

Tier 2 runs each fixture twice per model: once as a tooled run, once as a baseline run. We compare the two outcomes side by side. This comparison shows whether the three tools help.

## Status

We track each tier as a GitHub issue. We build the tiers in order: Tier 0, then Tier 1, then Tier 2.
