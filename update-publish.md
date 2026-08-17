# Publishing an Update — the full flow

From change to "users see the notification in their installed XEKUTE", in one
place. The rule of thumb: **main stays always-green; a PR is the review
checkpoint; a git tag ships the release.**

```
main → branch (build feature) → test → push branch → PR (gate runs) → merge → sync
     → bump version → commit → tag vX.Y.Z → push tag → [release workflow publishes]
     → installed clients get the toast → Install → auto-update & relaunch
```

## 1. Start from a clean `main`

```bash
git checkout main
git pull
```

## 2. Create a temporary branch

```bash
git checkout -b auto-update-feature      # or: git switch -c auto-update-feature
```

## 3. Make your changes and test locally

```bash
# ...edit code...
git add .
git commit -m "feat: describe the change in one line"   # not just "updated"
npm test
```

Optional sanity builds before pushing:
- `npm run dev` — runs the app with the **mock** update flow (toast appears without a real release)
- `npm run make` — verifies the Windows package still builds

## 4. Push the branch

```bash
git push -u origin auto-update-feature
```

`-u` is required the first time so git remembers the branch. Pushing uploads the
**branch only** — `main` is untouched until you merge.

## 5. Open a Pull Request (the gate runs here)

Use the link git prints after pushing, the yellow **Compare & pull request**
button on GitHub, or the CLI:

```bash
gh pr create --title "feat: auto-update feature" --body "What it does and why"
```

The `windows-production.yml` gate then runs against the PR: audit → native
verify → production verify → full test suite → package. **Green ✓ = safe to
merge** (red ✗ = fix it first).

## 6. Merge into `main`

```bash
gh pr merge --squash --delete-branch
```

or click **Merge pull request** on GitHub (use *Squash and merge* for one clean
commit). This is the moment the code actually lands on `main`.

## 7. Sync your local `main`

```bash
git checkout main
git pull
git branch -d auto-update-feature        # if not already deleted
```

## 8. Release the new version

Bump the version, commit, then tag. The tag **must equal** the version in
`package.json` — the release workflow refuses to publish otherwise.

```bash
npm version 0.2.0 --no-git-tag-version    # bumps package.json + package-lock.json
git add package.json package-lock.json
git commit -m "chore: bump version to 0.2.0"
git push

git tag v0.2.0                            # tag name = v + version
git push origin v0.2.0
```

## 9. What happens automatically

The `windows-release.yml` workflow (triggered by the `v*` tag):

1. verifies the tag matches `package.json`
2. runs the full verification + **test suite** (a red build can never ship)
3. builds the installer (signed when the certificate secret is set)
4. publishes a **full** GitHub Release with `RELEASES`, the `.nupkg`, and
   `XEKUTESetup.exe`
5. `update.electronjs.org` starts serving it as an update

Every installed XEKUTE then shows the update toast on next launch → **Install**
→ downloads, closes itself, applies the update, and reopens on the new version.

## 10. Verify the release

- **GitHub → Releases:** assets present, marked as a **release** (never
  pre-release — the update feed ignores pre-releases).
- **In-app:** open the packaged app → Help → **Check for Updates** → toast
  appears with the new version.
- If you need to test the flow without a real release, a dev build uses the
  mock updater automatically.

## Rules that keep this safe

- `main` is trunk — one permanent branch, always green.
- Bigger changes go through a temporary branch + PR; the gate runs on both
  direct pushes and PRs.
- Only a tag publishes a release — branches and PRs never do.
- Never tick **pre-release** when publishing manually; your own workflow
  publishes full releases for you.
- If a critical bug hits shipped users, tag a patch (`v0.2.1`) from a hotfix
  branch — temporary branch → PR → merge → tag, same as above.
