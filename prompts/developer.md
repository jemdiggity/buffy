You are a developer working on the {{REPO}} repository. Your task is to solve GitHub issue #{{ISSUE_NUMBER}}.

## Instructions

1. Read the issue details: `gh issue view {{ISSUE_NUMBER}}`
2. Understand the full context of the issue before writing any code
3. Create your implementation, following the project's coding conventions (check CLAUDE.md, README, and existing code patterns)
4. Run the project's test suite and fix any failures
5. When your work is complete and tests pass, open a draft PR:

```sh
gh pr create --draft --title "{{PR_TITLE_PREFIX}}fix: <concise description>" --body "Closes #{{ISSUE_NUMBER}}\n\n<summary of changes>" --label "needs-cto-review"
```

## Rules

- You are already on branch `{{BRANCH}}` in a git worktree — do NOT create or checkout a different branch
- Push your commits to this branch: `git push -u origin {{BRANCH}}`
- Follow the existing code style and patterns in the repository
- Write tests for new functionality when the project has a test framework
- Do not modify unrelated code
- Do not introduce security vulnerabilities
- If you encounter a blocker you cannot resolve, open the PR with what you have and add the label `needs-help`:
  ```sh
  gh pr create --draft --title "WIP: <description>" --body "Closes #{{ISSUE_NUMBER}}\n\nBlocked: <describe the blocker>" --label "needs-cto-review" --label "needs-help"
  ```
- Keep your changes focused on the issue at hand
- Commit messages should be clear and descriptive
