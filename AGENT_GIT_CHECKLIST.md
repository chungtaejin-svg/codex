# Agent Git Upload Checklist

## 1) One-time repo setup

```bash
git init
git branch -m main
git remote add origin https://github.com/<USER>/<REPO>.git
```

If `origin` already exists:

```bash
git remote set-url origin https://github.com/<USER>/<REPO>.git
```

## 2) Before commit

```bash
git status -sb
```

- Verify changed files.
- Stage only intended files (avoid temporary files/screenshots).

## 3) Commit only target files

```bash
git add <file1> <file2> ...
git commit -m "type: short summary"
```

Examples:

```bash
git add solar.app.js solar.index.html
git commit -m "feat: update print/report behavior"
```

## 4) Push

```bash
git push origin main
```

## 5) Common fixes

### A. Not a git repository

```bash
git init
```

### B. Dubious ownership (safe.directory)

```bash
git config --global --add safe.directory <ABSOLUTE_REPO_PATH>
```

### C. Non-fast-forward (remote has newer commit)

```bash
git pull --rebase origin main
git push origin main
```

### D. Check remotes

```bash
git remote -v
```

## 6) Optional: first push with upstream tracking

```bash
git push -u origin main
```

## 7) Do not do by default

- Do not `git add .` blindly.
- Do not include secrets (`.env`, keys, credentials).
- Do not use destructive reset commands unless explicitly requested.
