# Rules for AI contributors

Konnect follows the same rules as KuartalOS (`kuartal-id/kuartalos/AGENTS.md`). Several AIs work on it (Claude, ChatGPT/Codex, Gemini, Grok, Kimi), and Diemas is the final approver.

## Before you start

1. Read [STATUS.md](STATUS.md) and the top 3 entries of [docs/HANDOFF_LOG.md](docs/HANDOFF_LOG.md).
2. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), especially the encryption and CRM sections, before touching `src/lib/matrix.ts` or `src/lib/crm.ts`.

## Before you finish

- Add an entry at the top of `docs/HANDOFF_LOG.md`: date, which AI you are, what changed, what is unfinished, what's next.
- Update `STATUS.md`.
- The PR description ends with *Changed / Not done yet / How to test*.

## How to work

- Branch `<ai>/<issue>-<short-name>`. Never push to `main`. One focused PR per task.
- **Never merge and never deploy.** Diemas merges after he writes "go". Merging to `main` deploys.
- `npm run typecheck` and `npm run build` must pass.
- TypeScript strict, React, Vite. Poppins, calm and flat, no purple gradients, no emoji in UI. User-facing text in English for now.

## Encryption and privacy rules (Konnect-specific)

- Don't add any code path that sends message content, CRM content, recovery keys or access tokens to a server other than the person's Matrix server, to logs, or to an AI model.
- Don't render HTML from messages (`formatted_body`). Plain text only, with links made clickable.
- Never call `bootstrapCrossSigning` on an account that already has secret storage before the recovery key is unlocked. See `unlockWithRecoveryKey`.
- The CRM stays encrypted in the browser. Changing its format means a new event type (`…crm.v2`) plus a migration, not an in-place change.
- Anything that sends, deletes or leaves on someone's behalf needs a visible user action.
