---
name: openclaw-pr-maintainer
description: Maintainer workflow for reviewing, triaging, preparing, closing, or landing OpenClaw pull requests and related issues. Use when Codex needs to validate bug-fix claims, search for related issues or PRs, apply or recommend close/reason labels, prepare GitHub comments safely, check review-thread follow-up, or perform maintainer-style PR decision making before merge or closure.
---

# OpenClaw PR Maintainer

Use this skill for maintainer-facing GitHub workflow, not for ordinary code changes.

## Apply close and triage labels correctly

- If an issue or PR matches an auto-close reason, apply the label and let `.github/workflows/auto-response.yml` handle the comment/close/lock flow.
- Do not manually close plus manually comment for these reasons.
- `r:*` labels can be used on both issues and PRs.
- Current reasons:
  - `r: skill`
  - `r: support`
  - `r: no-ci-pr`
  - `r: too-many-prs`
  - `r: testflight`
  - `r: third-party-extension`
  - `r: moltbook`
  - `r: spam`
  - `invalid`
  - `dirty` for PRs only

## Enforce the bug-fix evidence bar

- Never merge a bug-fix PR based only on issue text, PR text, or AI rationale.
- Before landing, require:
  1. symptom evidence such as a repro, logs, or a failing test
  2. a verified root cause in code with file/line
  3. a fix that touches the implicated code path
  4. a regression test when feasible, or explicit manual verification plus a reason no test was added
- If the claim is unsubstantiated or likely wrong, request evidence or changes instead of merging.
- If the linked issue appears outdated or incorrect, correct triage first. Do not merge a speculative fix.

## Handle GitHub text safely

- For issue comments and PR comments, use literal multiline strings or `-F - <<'EOF'` for real newlines. Never embed `\n`.
- Do not use `gh issue/pr comment -b "..."` when the body contains backticks or shell characters. Prefer a single-quoted heredoc.
- Do not wrap issue or PR refs like `#24643` in backticks when you want auto-linking.
- PR landing comments should include clickable full commit links for landed and source SHAs when present.

## Search broadly before deciding

- Prefer targeted keyword search before proposing new work or closing something as duplicate.
- Use `--repo openclaw/openclaw` with `--match title,body` first.
- Add `--match comments` when triaging follow-up discussion.
- Do not stop at the first 500 results when the task requires a full search.

Examples:

```bash
gh search prs --repo openclaw/openclaw --match title,body --limit 50 -- "auto-update"
gh search issues --repo openclaw/openclaw --match title,body --limit 50 -- "auto-update"
gh search issues --repo openclaw/openclaw --match title,body --limit 50 \
  --json number,title,state,url,updatedAt -- "auto update" \
  --jq '.[] | "\(.number) | \(.state) | \(.title) | \(.url)"'
```

# Posting PR Review Comments via `gh`

## Core rule

Comments on **any line of a file in the PR** are supported — including lines far outside the visible diff hunk. This is proven: other agents (GPT-5 via codex, Opus 4.6 via API) have posted hundreds of such comments on this user's repos using the same `gh` and the same token you have right now. If a request fails, the cause is something in your payload, not a capability limit of the API.

Do **not** rationalize failures with any of these theories:
- "GitHub can't resolve lines outside the hunk" — false
- "The API only accepts lines in the diff" — false
- "This token has a restricted schema" — false (the user confirmed this; same token works in hundreds of prior sessions)
- "Server-side resolution only works near the hunk" — fabricated

These theories are tempting because they are specific enough to sound investigated. They are wrong. If you find yourself reaching for one, stop and re-read the actual error response.

## Non-negotiable error-handling rule

**Before proposing any theory about why a request failed, show the user the raw HTTP response body verbatim.** This means:

```bash
gh api ... --include 2>&1 | tee /tmp/gh-response.txt
cat /tmp/gh-response.txt
```

Or capture the failure explicitly:

```bash
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  /repos/OWNER/REPO/pulls/PR_NUMBER/reviews \
  --input /tmp/review.json \
  2>&1 | tee /tmp/gh-error.txt
```

The real GitHub error will say one of:
- `"pull_request_review_thread.line must be part of the diff"`
- `"path diff too large"`
- `"Invalid request. For 'properties/comments/N/line', nil is not an integer"`
- `"Validation Failed"` with a specific field in the `errors` array
- `"Not Found"` if owner/repo/PR number is wrong

These messages tell you exactly what to fix. If you can't show a real error message, you don't have grounds for any theory about what's wrong.

## The working pattern

Use the **reviews** endpoint (`POST /repos/{owner}/{repo}/pulls/{pr}/reviews`) with `--input` reading a JSON file from stdin or a path. This is the pattern that has been confirmed working on this setup for lines outside the diff hunk.

Do not use:
- `gh pr review --comment` / `--body-file` with inline comments
- The individual `POST /pulls/{n}/comments` endpoint with `-f`/`-F` flags (schema-restricted on some tokens)
- The `position` field (legacy, diff-relative, constrains you to the hunk)

## Step-by-step

### 1. Get the head SHA

```bash
HEAD_SHA=$(gh pr view PR_NUMBER --json headRefOid -q .headRefOid)
```

### 2. Write the review payload to a file

Write to `/tmp/review-PRNUM.json`. Use a JSON file rather than heredoc-to-stdin — it's easier to debug and re-run.

```json
{
  "commit_id": "HEAD_SHA_HERE",
  "event": "COMMENT",
  "body": "Optional top-level review body.",
  "comments": [
    {
      "path": "resources/views/components/membership-section.blade.php",
      "line": 35,
      "side": "RIGHT",
      "body": "Single-line comment on line 35."
    },
    {
      "path": "resources/views/filament/insights/pages/memberships.blade.php",
      "start_line": 46,
      "start_side": "RIGHT",
      "line": 91,
      "side": "RIGHT",
      "body": "Multi-line comment spanning 46–91."
    }
  ]
}
```

Rules for the `comments` array:
- `path` is relative to repo root.
- `line` is the **absolute file line number** at `commit_id`, not a diff offset.
- `side` is `RIGHT` for the new version of the file, `LEFT` for the old. Use `RIGHT` unless commenting on a deleted line.
- For multi-line: `start_line` + `start_side` mark the beginning, `line` + `side` mark the end. Both lines must exist in the file at `commit_id`.
- No `position` field. Ever.
- No `subject_type` field — only needed for file-level comments, and not for line-anchored ones.

### 3. Post it

```bash
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  /repos/OWNER/REPO/pulls/PR_NUMBER/reviews \
  --input /tmp/review-PRNUM.json
```

### 4. Pending vs submitted

- Omit `"event"` entirely → review stays pending, user submits manually in GitHub UI.
- `"event": "COMMENT"` → submitted immediately as a comment review.
- `"event": "APPROVE"` / `"REQUEST_CHANGES"` → submitted with that status.

If the user said "post as pending," omit the `event` key.

## If the post fails

**First: show the raw response body. No exceptions.** Then consult this table:

| Error message contains | Real cause | Fix |
|---|---|---|
| `line must be part of the diff` | Using the individual `/pulls/{n}/comments` endpoint (which IS hunk-restricted), or using the `position` field | Switch to `POST /pulls/{n}/reviews` with `line`/`side` in the `comments` array |
| `Invalid request. For 'properties/comments/N/...'` | Malformed JSON — missing required field, wrong type, or null value | Read which field the error names and fix that field |
| `path diff too large` | File has too many changes for GitHub to render a diff | Rare; may need to comment on a different file |
| `path not part of the diff` | File path typo, or file not touched in this PR | Verify with `gh pr diff PR_NUMBER --name-only` |
| `commit_id is not valid` | Stale or wrong SHA | Re-fetch with `gh pr view PR_NUMBER --json headRefOid -q .headRefOid` |
| `Validation Failed` without specifics | JSON structure is wrong at a level the API can't name | Validate with `jq . /tmp/review.json` and check against the schema below |
| `404 Not Found` | Wrong owner/repo/PR number, or private repo token can't see | Verify with `gh repo view OWNER/REPO` and `gh pr view PR_NUMBER` |
| `403` | Genuinely rare given the user's auth works elsewhere; probably not this | Check `gh auth status` only if everything else is eliminated |

## Hard prohibitions

- **Do not** post comments on different lines than the user requested because the requested lines "didn't work." Report the failure and stop.
- **Do not** claim "GitHub can't resolve lines outside the diff hunk." It can.
- **Do not** claim "the API won't accept lines that aren't in the diff." It will.
- **Do not** claim this specific token has a restricted schema. It doesn't — the user has confirmed it works in hundreds of other sessions with other agents.
- **Do not** fall back to `position`-based commenting.
- **Do not** relocate comments and then tell the user they reference the original line numbers in the body. That's worse than failing.
- **Do not** offer the user a choice between "switch tokens" and "post comments on wrong lines" when you haven't shown them the real error response.

## Reference: what other agents do successfully

GPT-5 via codex and Opus 4.6 via API on this setup post to arbitrary file lines (line 35, 46–91, etc.) using exactly the pattern above: reviews endpoint, JSON input file, `line`/`side` fields, no `position`. If it works for them it works for you — the token, schema, and endpoint are identical.

## Follow PR review and landing hygiene

- If bot review conversations exist on your PR, address them and resolve them yourself once fixed.
- Leave a review conversation unresolved only when reviewer or maintainer judgment is still needed.
- When landing or merging any PR, follow the global `/landpr` process.
- Use `scripts/committer "<msg>" <file...>` for scoped commits instead of manual `git add` and `git commit`.
- Keep commit messages concise and action-oriented.
- Group related changes; avoid bundling unrelated refactors.
- Use `.github/pull_request_template.md` for PR submissions and `.github/ISSUE_TEMPLATE/` for issues.

## Extra safety

- If a close or reopen action would affect more than 5 PRs, ask for explicit confirmation with the exact count and target query first.
- `sync` means: if the tree is dirty, commit all changes with a sensible Conventional Commit message, then `git pull --rebase`, then `git push`. Stop if rebase conflicts cannot be resolved safely.
