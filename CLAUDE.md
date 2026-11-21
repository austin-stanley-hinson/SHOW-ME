# Show Me — rules for every Claude agent

**Read this whole file before every task.** Several agents (one per teammate) work in this repo at the same time. These rules keep us from overwriting each other's work and keep `main` deployable.

## The project

"Other AI assistants tell you. This one shows you." It's a web app for iPhone Safari. You point the camera at something and ask a question. Gemini returns structured JSON, and we draw arrows, labels, steps and a math panel over the live camera view with three.js.
WHACK hackathon, Nov 21–22, 2026. A working demo matters more than extra features.

Stack: Vite + React, three.js, a server endpoint that calls the model (Gemini by default, swappable via `MODEL_PROVIDER`), Vercel hosting, and a small session relay on Vultr (`server/`).

## Rules that always apply

1. **The model computes, our code checks** (`src/physics/calc.js`). The model shows its work as a calc sheet; every step is re-computed and marked ✓/⚠, the verdict is checked, and numbers in free text are audited. Never show a model number without its check status.
2. **Label estimates as estimates**, e.g. "~4 kg (estimated)", and show their assumptions.
3. **The Gemini API key exists only on the server.** Read it as `process.env.GEMINI_API_KEY`. Never use a `VITE_` prefix, never put it in client code, and never commit it.
4. **Send a camera frame only when the user asks a question.** Never store it or log it on the server.
5. **Accessibility:** every answer gets a caption, text has readable contrast, tap targets are at least 44×44px, and nothing flashes.
6. **iOS:** use `<video playsinline muted autoplay>`. Request the DeviceOrientation permission and unlock audio inside a user tap handler, ideally the first "Start" tap. Camera and gyroscope need HTTPS, so test on Vercel preview URLs.
7. **Keep it simple.** Add no new dependencies without the owner's human agreeing. Don't refactor code you don't own. Don't add speculative features.

## File ownership (prevents clashes)

Each lane owns certain files. **Only edit files your lane owns.** If you need a change in another lane's file, stop and tell your human what the change is so they can pass it to the owner. Don't make the edit yourself.


| Lane | Owner | Files |
|---|---|---|
| **A: Client / Renderer** | Austin | `src/camera/`, `src/orientation/`, `src/overlay/` (three.js), `src/ui/`, `src/App.jsx`, `src/main.jsx`, `index.html`, `src/styles/` |
| **B: Server / Gemini / Math** | Josh | `api/` (server endpoint, model providers, prompt), `server/` (session relay on Vultr), `src/physics/`, `src/client/` (askApi, session, view, narrator, guide) |
| **Shared (both must agree)** | both | `CONTRACT.md`, `package.json`, `package-lock.json`, `vite.config.js`, `vercel.json`, `.gitignore`, `CLAUDE.md`, `README.md` |

Rules for shared files:
- **`CONTRACT.md` is the contract between the lanes.** Change it only in its own PR, after both humans agree. Bump the version in its title, and say what changed in the PR description.
- **Dependencies:** keep `package.json` changes in a small commit of their own (`chore(deps): add X`). Merge it to `main` quickly so the other lane can rebase. If `package-lock.json` conflicts, don't hand-merge it: take `main`'s version and run `npm install` again.
- **New folders** belong to the lane that creates them. Add them to the table above in the same PR.

## The contract: see `CONTRACT.md`

**`CONTRACT.md` is the only source of truth** for the JSON shape that passes between Gemini, the server and the renderer. Read it before any task that touches the response. Don't copy the schema anywhere else (including into this file), so there is never a second version to drift.

The rule that matters most is "the model computes, our code checks." The model returns a `calc` sheet (inputs, formulas and its own results). `evaluateCalc` re-computes and checks every step, and the renderer shows each value with its check status using each draw item's `quantity`.

## Git workflow (keep it clean)

- **`main` must always build and deploy.** Never commit directly to `main`. Never force-push `main`.
- **Branches:** `<lane>/<short-task>`, e.g. `a/gyro-recenter` or `b/gemini-endpoint`. Use one small branch per task, and keep it short-lived (hours, not a day).
- **Before starting a task:** `git fetch && git switch main && git pull --ff-only`, then create the branch.
- **Before merging:** `git fetch && git rebase origin/main`, then run `npm run build`. If the rebase hits a conflict in a file you don't own, stop and ask your human.
- **Merge** with a GitHub PR, squash-merged, and delete the branch afterwards. The agent may open the PR. **Only a human merges it.**
  - **PRs that touch only your own lane:** your own human can merge once `npm run build` passes and the Vercel preview works. No waiting on the other person.
  - **PRs that touch a shared file** (`CONTRACT.md`, `package.json`, configs): the other human must approve before the merge.
  - **Test on the phone** using the Vercel preview URL attached to each PR. Don't merge camera or gyroscope changes that haven't been tried on an iPhone.
- **Sync often:** after anything merges, rebase your current branch onto `origin/main` so the lanes don't drift apart.
- **Commit messages** use Conventional Commits: `feat(overlay): draw force arrows`, `fix(api): handle empty Gemini response`, `chore(deps): ...`. Use one logical change per commit.
- **Never commit:** `.env*`, API keys, `node_modules/`, `dist/`, `.vercel/`, captured camera frames, or `.DS_Store`.
- **Don't rewrite shared history:** no `git push --force` on a branch someone else is using, and no `git reset --hard` on uncommitted work you didn't create. If you're unsure, ask.
- **Stage files explicitly** (`git add <paths>`) rather than `git add -A`. That way you never sweep in another lane's files or stray files.

## How agents should work

- **Start of task:** confirm which lane you're in (ask your human if it's unclear), pull the latest `main`, and read `CONTRACT.md`.
- **Coding against the other lane:** if you need something the other lane hasn't built yet, mock it locally in your own files, e.g. a fixture JSON in `src/client/fixtures/` or `api/fixtures/`. Don't build it in their files.
- **End of task:** say what you changed, which files, whether `npm run build` passed, and anything the other lane needs to know (especially schema or dependency changes).
- **Report test results honestly.** If you couldn't test on a real iPhone, say so.

## Commands

```bash
npm install
npm run dev        # local dev (the camera needs HTTPS on the phone, so use a Vercel preview for device testing)
npm run build      # must pass before every PR
```

## Fallback plan

If lining up the 3D overlay with the live camera turns out to be unreliable, switch to **freeze and annotate**: draw on the captured frame and use the gyroscope only for slight movement. Don't switch without telling both humans, because it affects both lanes.
