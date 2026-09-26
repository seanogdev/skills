# seanogdev/skills

Public Claude Code / agent-skills repo. Each skill lives at `skills/<name>/SKILL.md`. Write every
skill so it works on any machine:

- No machine-specific paths, shell functions, or other assumptions about one particular setup. A
  skill that needs those belongs in a personal machine-config repo instead, not here.
- Make each skill standalone where possible. Do not refer to another skill, in this repo or
  elsewhere. You cannot know which skills a user has installed. Put what the skill needs into the
  skill itself.
- `license: MIT` in every `SKILL.md` frontmatter.
- Keep `evals/descriptions/<name>.json` in sync with each skill's trigger phrasing. Run
  `scripts/optimize-skill-descriptions.sh` after changing a `description` field.
- The repo root is also a Claude Code plugin root (`.claude-plugin/`). Adding a skill under
  `skills/` is enough; there is no separate list to update.
- The `Skill` tool never reads this repo directly. It reads the installed copy under
  `~/.agents/skills/<name>`, which `gh skill` pins to a commit at install time. Editing a
  `SKILL.md` here, even after a push, changes nothing a subagent sees until that install is
  refreshed. To test an edited skill, push it, then run `skills-update` before invoking it.
