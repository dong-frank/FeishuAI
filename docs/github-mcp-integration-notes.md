# GitHub MCP Integration Notes

## Context

The TUI Git Agent now receives richer local Git context through `tuiSession.git`,
including current branch, upstream, dirty counts, branch lists, remotes, and
best-effort remote web URLs.

The next possible extension is to integrate GitHub platform context through the
official GitHub MCP Server, so the Agent can reason about PRs, CI, and repository
state beyond local Git data.

## GitHub MCP Capabilities

GitHub provides an official MCP server: `github/github-mcp-server`.

Relevant toolsets include:

- `context`: current GitHub user and operating context.
- `repos`: repository files, code search, commits, and repo metadata.
- `pull_requests`: PR lookup, creation, updates, comments, and review workflows.
- `issues`: issue lookup and management.
- `actions`: GitHub Actions workflows, runs, jobs, artifacts, and logs.
- `users` / `orgs`: user, organization, and collaborator context.
- `code_security`, `dependabot`, `secret_protection`: security and dependency alerts.

The default toolsets are `context`, `repos`, `issues`, `pull_requests`, and
`users`. For this project, a smaller initial set is preferable.

## Recommended Initial Scope

Start with a read-mostly integration using:

- `context`
- `repos`
- `pull_requests`
- `actions`

Avoid enabling broad toolsets such as `all` for the first version.

The first useful workflows are:

- After `git push`, detect whether the current branch already has a PR.
- If a PR exists, show its URL, state, reviewers, and CI summary.
- If no PR exists, suggest the next action for creating one.
- If GitHub Actions failed, summarize the failing workflow/job and point to logs.
- Optionally hand the summarized PR or CI status to the Lark Agent for notification.

## Integration Shape

Suggested flow:

```text
Git command succeeds
  -> local tuiSession.git identifies branch and remote webUrl
  -> GitHub MCP resolves repository, branch, PR, and workflow state
  -> Git Agent renders concise content and suggestedCommand
  -> optional Lark Agent sends PR/CI notification
```

Keep local Git context as the first source of truth for workspace state. Use
GitHub MCP only for platform state: PRs, reviews, Actions, GitHub URLs, and
collaboration metadata.

## Safety Notes

- Require explicit GitHub authentication through a token or configured MCP server.
- Keep first-version tools read-only where possible.
- Do not auto-create PRs, comments, merges, or review requests without user confirmation.
- Prefer narrow toolsets over `all` to reduce accidental tool use and prompt noise.
- Treat remote URL to GitHub repo mapping as best-effort; if unknown, fall back to local Git suggestions.

## Potential Future Features

- `git push` success: show existing PR URL or suggest PR creation.
- PR status card in TUI history: PR number, title, state, reviewers, checks.
- CI failure helper: summarize failed Action logs and suggest next debugging command.
- Lark notification: send PR created / CI failed / review requested summaries.
- PR maintenance commands: request reviewers, comment, or mark ready for review after confirmation.

