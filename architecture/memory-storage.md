# Session-memory storage

Durable memory is owned by `src/app/storage/session-memory-store.js` and is
written beneath `%USERPROFILE%\\.xekute\\data`:

```text
%USERPROFILE%\\.xekute\\data\\
├── project-registry.json
└── projects\\<project-id>.json
```

Each project file contains a project envelope, session metadata, sequential
`block_1`, `block_2`, ... records, questions, ordered repeated tool names, and
an internal transcript. Message text is preserved exactly. Electron
`safeStorage` encrypts payloads when available; otherwise the store uses a
protected plain-JSON fallback. Writes use a temporary file plus atomic replace
and retain a backup for recovery.

Persistence is lazy: a new chat or unsent draft creates no disk record. The
first non-empty submitted prompt creates the real session and first block.
Incomplete turns are retained when the model stops, fails, or produces only
partial output. Closing a session retains it in history; permanent deletion is
explicit. Legacy chat files are imported only by the standalone migration
command (`npm run migrate:chat-memory`), with `--dry-run` support. Migration is
idempotent and never edits or removes legacy files.
