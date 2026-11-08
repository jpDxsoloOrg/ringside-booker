---
title: 'Foundations: one World, deterministic days'
slug: ringside-booker-02-foundations
series: ringside-booker
part: 2
status: draft
excerpt: How one World store and a seeded day loop keep every simulated day reproducible.
tags: [simulation, typescript]
journal: []
---

## Opening

The **World** store holds every table the game needs, and the day loop in
[`core/pipeline`](../../packages/engine/src/core/pipeline.ts) runs each system in a fixed order,
so the same seed always gives the same week of shows, the same injuries and the same money in the
bank at the end of it.

## RNG

Named streams.
