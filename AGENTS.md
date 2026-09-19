# seanogdev/skills

Public Claude Code / agent-skills repo. Each skill lives at `skills/<name>/SKILL.md` and is
installed on other people's machines via `gh skill`, `npx skills`, or the Claude Code plugin. Write
every skill so it works on any machine:

- No dotfiles-specific paths, fish functions, or other machine-only assumptions. If a skill needs
  something like that, it belongs in seanogdev/dotfiles instead, not here.
- `license: MIT` in every `SKILL.md` frontmatter.
- Keep `evals/descriptions/<name>.json` in sync with each skill's trigger phrasing. Run
  `scripts/optimize-skill-descriptions.sh` after changing a `description` field.
- The repo root is also a Claude Code plugin root (`.claude-plugin/`). Adding a skill under
  `skills/` is enough; there is no separate list to update.
