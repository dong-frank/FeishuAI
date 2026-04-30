# FlowDesk Experiment

FlowDesk is a reusable experiment fixture for validating `git-helper` in a simulated Scrum onboarding workflow.

The generated project is independent from this repository. Reset commands write only under `.experiments/`:

```bash
npm run experiment:flowdesk -- reset
npm run experiment:flowdesk -- reset --stage commit-message
npm run experiment:flowdesk -- reset --stage conflict
npm run experiment:flowdesk -- reset --stage upstream
npm run experiment:flowdesk -- reset --stage post-push
npm run experiment:flowdesk -- export
npm run experiment:flowdesk -- score
```

Typical manual demo loop:

1. Reset to a stage.
2. `cd .experiments/flowdesk-demo`
3. Start `git-helper`.
4. Run the printed command and observe the expected phase.

The local Markdown files in `fixtures/lark-docs/` stand in for Feishu documents so the experiment remains reproducible before syncing to a real workspace.

For the `conflict` stage, use `git merge origin/main` rather than a rebase.
After resolving `service.py`, finish with `git add flowdesk/tickets/service.py`
and `git commit -m "merge main into FD-124 priority filter"` so the full demo
stays non-interactive inside the TUI.

## Scenario Roles

The reusable story keeps the team to four people:

- Scrum Master: 周启明. He hosts the morning standup, surfaces blockers, and
  nudges review meetings forward.
- Product Owner: 林若澄. She checks Sprint 12 progress and cares whether
  `FD-124` has moved from development to review.
- Senior Developer: 许嘉宁. She owns the tickets module collaboration path and
  watches the project CI/CD flow.
- New Developer: 饶东申. He is the protagonist and uses `git-helper` after the
  standup to complete his first task. In the Lark group simulation, this role
  sends as the real user identity instead of a role bot.

The morning standup is only narrative setup. It assigns `FD-124` to 饶东申,
mentions that 许嘉宁 is changing related list behavior and CI/CD, and explains
why the later push should lead to a review meeting. The tool demo starts after
饶东申 returns to the terminal.
