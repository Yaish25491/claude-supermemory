---
description: Index codebase into Supermemory for persistent context
allowed-tools: ["Read", "Glob", "Grep", "Bash", "Task"]
---

# Codebase Indexing

Explore this codebase deeply and compile findings into Supermemory.

## Phase 1: Project Overview

Read and note:
- `package.json` / `Cargo.toml` / `pyproject.toml` / `go.mod`
- `README.md`
- Config files (tsconfig, eslint, etc.)

Gather: project name, purpose, tech stack, how to run/build/test

## Phase 2: Architecture

Explore and note:
- Use Glob to understand folder structure
- Find entry points (index.ts, main.py, App.tsx)
- Identify API routes, database models

Gather: architecture, key modules, data flow

## Phase 3: Conventions

Analyze and note:
- Naming conventions
- File organization
- Import patterns
- Git history: `git log --oneline -20`

Gather: coding conventions, patterns to follow

## Phase 4: Key Files

Read and note:
- Auth logic
- Database connections
- API clients
- Shared utilities

Gather: where important logic lives

## Final Step: Save to Supermemory

After exploring all phases, compile everything into one comprehensive summary and save:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/add-memory.cjs" "YOUR COMPILED FINDINGS HERE"
```

Include: tech stack, architecture, conventions, key files, important patterns.

## Instructions

- Make ~20-50 tool calls to explore thoroughly
- Skip node_modules, build outputs, generated files
- Compile all findings at the end into one save

Start now.
