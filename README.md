# new-project

Placeholder scaffold. The real name, goal, and scope get filled in as soon as
the project spec (`.md` file) is dropped in.

## Working agreement for this repo

- **Commit after every step**, with a message that explains *what* changed and
  *why* — not just "update".
- **Comment the code** so every non-obvious block says what it is supposed to do.
- **Secrets live in `.env`** (git-ignored). Variable names get documented in
  `.env.example`.

## Layout

```
new-project/
├── .gitignore      # what git should never track (secrets, caches, builds)
├── README.md       # this file — what the project is and how to run it
└── docs/           # the project spec and any design notes
```
