# [UI-20] MainMenuButton test is flaky

## Context
Found while writing the App shell journal (UI-14). The MainMenuButton test fails on and off.

## Subtasks
- [ ] Find the race (timers, focus, or an un-awaited state update) and fix it
- [ ] Run the test 50 times in a row with no failures
