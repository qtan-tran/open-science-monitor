// Git + gh operations used ONLY inside GitHub Actions (weekly workflow).
// Locally the pipeline writes files and prints a summary; it skips this
// module entirely.
//
// Phases:
//   gitPrepare()  - switch to the per-week branch BEFORE writing files
//   gitFinalize() - commit, push, open/update the weekly PR AFTER writing

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

function git(args: string[], opts: { cwd: string; allowFail?: boolean }): string {
  try {
    return execFileSync("git", args, { cwd: opts.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    if (opts.allowFail) return "";
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`git ${args.join(" ")} failed: ${msg}`);
  }
}

function gh(args: string[], opts: { cwd: string }): string {
  return execFileSync("gh", args, { cwd: opts.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

export interface GitCiOptions {
  root: string;
  week: string;
}

function baseBranch(): string {
  if (process.env.GITHUB_REF_TYPE === "branch" && process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME;
  }
  return "main";
}

function branchName(week: string): string {
  return `issue/${week}`;
}

/** Switch the working tree to the per-week branch (creating it if needed).
 *  Must run BEFORE the pipeline writes any files. Idempotent. */
export function gitPrepare({ root, week }: GitCiOptions): void {
  const branch = branchName(week);
  const base = baseBranch();

  if (!git(["config", "user.email"], { cwd: root, allowFail: true })) {
    git(["config", "user.email", "actions@github.com"], { cwd: root });
  }
  if (!git(["config", "user.name"], { cwd: root, allowFail: true })) {
    git(["config", "user.name", "open-science-monitor[bot]"], { cwd: root });
  }

  const remoteBranch = git(["ls-remote", "--heads", "origin", branch], { cwd: root, allowFail: true });
  if (remoteBranch) {
    git(["fetch", "origin", branch], { cwd: root });
    git(["switch", branch], { cwd: root });
    git(["merge", "--no-edit", `origin/${base}`], { cwd: root, allowFail: true }); // best effort; week files are disjoint
  } else {
    git(["switch", "-C", branch], { cwd: root });
  }
}

/** Commit the pipeline's writes, push, and open/update the weekly draft PR.
 *  Must run AFTER files are written. Re-runs reuse the branch and PR. */
export function gitFinalize({ root, week }: GitCiOptions): void {
  const branch = branchName(week);
  git(["add", "-A"], { cwd: root });
  if (git(["status", "--porcelain"], { cwd: root }) === "") {
    console.log("No changes to commit for this run.");
  } else {
    git(["commit", "-m", `issue(${week}): weekly run`], { cwd: root });
    git(["push", "-u", "origin", branch], { cwd: root });
  }

  const prBodyPath = path.join(root, "data", "run-reports", `${week}-pr-body.md`);
  if (!fs.existsSync(prBodyPath)) {
    console.log("PR body missing; nothing to update on the PR.");
    return;
  }
  const title = `Issue ${week}: weekly Open Access / Open Science briefing`;
  const existing = gh(
    ["pr", "list", "--head", branch, "--state", "open", "--json", "number", "--jq", ".[0].number"],
    { cwd: root },
  );
  if (existing) {
    gh(["pr", "edit", existing, "--body-file", prBodyPath, "--title", title], { cwd: root });
    console.log(`Updated PR #${existing} for ${branch}.`);
  } else {
    gh(
      [
        "pr", "create", "--draft",
        "--base", baseBranch(),
        "--head", branch,
        "--title", title,
        "--body-file", prBodyPath,
      ],
      { cwd: root },
    );
    console.log(`Opened draft PR for ${branch}.`);
  }
}
