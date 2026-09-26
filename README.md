# Skills

Sean O'Grady's personal Claude Code (and general agent-skills) skills:
`address-review`, `prune-merged-branches`, `quote-clip`.

Each one lives at `skills/<name>/SKILL.md`. This is the layout that Claude Code plugins,
`gh skill`, and the Vercel `skills` CLI all read.

## Installing

Pick whichever installer suits the machine. All three read the same `skills/` directory.

### gh skill

`gh skill` (GitHub CLI, preview) takes the repo path, so each skill is `skills/<name>`:

```sh
gh skill preview seanogdev/skills skills/quote-clip
gh skill install seanogdev/skills skills/quote-clip
gh skill install seanogdev/skills                             # all three
gh skill install seanogdev/skills quote-clip --pin v1.0.0     # pinned to a release
```

The repo is published to the registry under the `agent-skills` topic, so `gh skill search quote-clip`
finds it too.

### Claude Code plugin

The repo root is a plugin root and its own marketplace:

```
/plugin marketplace add seanogdev/skills
/plugin install seanog-skills@seanogdev
```

### npx skills

The [agent-skills CLI](https://github.com/vercel-labs/skills) works with any agent, not just Claude
Code:

```sh
npx skills add seanogdev/skills                 # pick from the three interactively
npx skills add seanogdev/skills -s quote-clip   # just one
npx skills add seanogdev/skills --all -g        # all three, user-level
npx skills add seanogdev/skills -l              # list them without installing
```

`-g` installs user-level, the default is the current project. `npx skills update` upgrades them
later.

## Evals

`evals/` holds trigger and output-quality fixtures for these skills. See `evals/README.md`.
`scripts/optimize-skill-descriptions.sh` runs the description-trigger evals and the
description-optimization loop.
