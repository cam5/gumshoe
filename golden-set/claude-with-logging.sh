#!/usr/bin/env bash
# Drives an interactive Claude Code session for a human-assisted "golden set" clone (see
# https://github.com/cam5/gumshoe/issues/8) and preserves its transcript + output inside the
# repo afterward. Interactive sessions already persist their own transcript by default -- the
# eval harness is the one that opts OUT of that, via --no-session-persistence, to stay stateless.
#
# The session's cwd is deliberately kept OUTSIDE this repo's tree (under
# $GUMSHOE_GOLDEN_SET_WORKDIR_ROOT, default ~/gumshoe-golden-set/<slug>/), not inside
# golden-set/<slug>/workdir/ as you might expect. Claude Code discovers project-level agents
# (.claude/agents/*.md) by walking up parent directories the same way git finds .git -- a real
# run of an earlier version of this script, cwd'd inside the repo, got its own top-level session
# (already seeded with cloner.md's body as its system prompt) to *also* discover cloner.md as an
# invokable sub-agent and delegate the whole task to it via Task, which then wrote its output to
# gumshoe/clones/<name>.html instead of the golden-set folder -- silently defeating the entire
# point of a human iterating hands-on. Running outside the repo tree means that discovery walk
# never finds .claude/agents/cloner.md, so there's nothing to delegate to.
#
# What this script adds beyond a plain `claude` invocation: pinning --session-id up front so we
# know exactly which transcript file it'll be, seeding the same system prompt as the "tooled"
# eval condition, and copying both the transcript and everything you wrote back into the repo
# once you exit.
#
# Usage: ./golden-set/claude-with-logging.sh <slug> <url> [-- extra claude args...]
#   slug   short name for this page, e.g. acme-pricing -- becomes golden-set/<slug>/
#   url    the live page to clone
#
# Iterate for as long as you like inside the session -- do the fetching/screenshotting/editing
# yourself, don't let it delegate to a sub-agent if one somehow still gets offered -- and exit
# normally (Ctrl+D, or "exit") when you're happy. clone.html and anything else you wrote get
# copied into golden-set/<slug>/workdir/ afterward.
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $0 <slug> <url> [-- extra claude args...]" >&2
  exit 1
fi

SLUG="$1"
URL="$2"
shift 2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RUN_DIR="$REPO_ROOT/golden-set/$SLUG"
mkdir -p "$RUN_DIR"

EXTERNAL_ROOT="${GUMSHOE_GOLDEN_SET_WORKDIR_ROOT:-$HOME/gumshoe-golden-set}"
WORKDIR="$EXTERNAL_ROOT/$SLUG"
mkdir -p "$WORKDIR"

case "$WORKDIR" in
  "$REPO_ROOT"/*|"$REPO_ROOT")
    echo "WORKDIR ($WORKDIR) is inside the repo -- that reintroduces the .claude/agents" >&2
    echo "discovery problem this script exists to avoid. Set GUMSHOE_GOLDEN_SET_WORKDIR_ROOT" >&2
    echo "to somewhere outside $REPO_ROOT." >&2
    exit 1
    ;;
esac

CLONER_MD="$REPO_ROOT/.claude/agents/cloner.md"
if [ ! -f "$CLONER_MD" ]; then
  echo "Can't find $CLONER_MD" >&2
  exit 1
fi
# Strips the YAML frontmatter the same way test/lib/run-agent.js's loadAgentDefinition does, so
# this human-driven session starts from the exact same system prompt as the "tooled" eval
# condition -- that's what makes a later comparison meaningful.
SYSTEM_PROMPT="$(awk 'BEGIN{n=0} /^---$/{n++; next} n>=2{print}' "$CLONER_MD")"
# Same fallback chain as run-agent.js's resolvedModel (model ?? frontmatter.model ?? "sonnet"):
# read the model straight out of cloner.md's own frontmatter, so this session runs the same
# model the eval harness does, without hardcoding it here where it could drift out of sync.
MODEL="$(awk '/^---$/{n++; next} n==1 && /^model:/{print; exit}' "$CLONER_MD" | sed -E 's/^model:[[:space:]]*//')"
MODEL="${MODEL:-sonnet}"

SESSION_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
WORKDIR_ABS="$(cd "$WORKDIR" && pwd)"
PROJECT_SLUG="$(printf '%s' "$WORKDIR_ABS" | sed 's/\//-/g')"
TRANSCRIPT_PATH="$HOME/.claude/projects/$PROJECT_SLUG/$SESSION_ID.jsonl"

# cloner.md itself says nothing about where to put screenshots -- the eval harness's own
# harnessAddendum (test/lib/run-agent.js) is what tells the "tooled" condition to write them
# into its workDir instead of /tmp. Without the same nudge here, a real run defaulted to /tmp:
# every original/clone/diff PNG across 7 rounds landed there instead of the workdir, invisible to
# this script's post-session copy step and one `rm -f` away from gone (two of them were, in fact,
# deleted by the agent's own end-of-session cleanup).
SCREENSHOT_ADDENDUM="$(cat <<EOF
For this session: there is a real local Chrome available headlessly, so crow-nester's
--screenshot flag can drive it directly without downloading a browser. Write every screenshot
and diff image you take -- at every round, not just the last one -- into this exact directory:
$WORKDIR_ABS -- not /tmp or anywhere else. Use a distinct filename per round (e.g. original.png,
clone-round1.png, diff-round1.png) rather than overwriting one filename, so every round is still
on disk when you finish. Leave them all there when you're done -- don't delete or "clean up"
screenshots or diffs as a tidiness step; they're part of the record of how you actually got to
the final result, not debug litter.
EOF
)"
SYSTEM_PROMPT="${SYSTEM_PROMPT}

${SCREENSHOT_ADDENDUM}"

cat > "$RUN_DIR/meta.json" <<JSON
{
  "slug": "$SLUG",
  "url": "$URL",
  "sessionId": "$SESSION_ID",
  "externalWorkDir": "$WORKDIR_ABS",
  "transcriptPath": "$TRANSCRIPT_PATH",
  "model": "$MODEL",
  "startedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

echo "golden-set run: $SLUG"
echo "  external workdir: $WORKDIR_ABS  (outside the repo -- see script header for why)"
echo "  model:            $MODEL  (from cloner.md's frontmatter, matching the eval harness)"
echo "  session id:       $SESSION_ID"
echo "  transcript:       $TRANSCRIPT_PATH"
echo
echo "Starting an interactive session seeded with the cloner prompt against:"
echo "  $URL"
echo "Do the work yourself, hands-on -- if it offers to delegate to a sub-agent, tell it not to."
echo "Iterate as long as you want. Exit normally (Ctrl+D / 'exit') when you're happy."
echo

cd "$WORKDIR"
set +e
claude \
  --session-id "$SESSION_ID" \
  --system-prompt "$SYSTEM_PROMPT" \
  --model "$MODEL" \
  --allowedTools "Bash,Read,Write,Edit" \
  -n "golden-set: $SLUG" \
  "$@" \
  "Clone this page into a single self-contained HTML file: $URL"
CLAUDE_EXIT=$?
set -e

echo
echo "Session ended (exit $CLAUDE_EXIT). Copying transcript and output into the repo..."

if [ -f "$TRANSCRIPT_PATH" ]; then
  cp "$TRANSCRIPT_PATH" "$RUN_DIR/session.jsonl"
  echo "  transcript saved to golden-set/$SLUG/session.jsonl"
else
  echo "  WARNING: no transcript found at $TRANSCRIPT_PATH" >&2
  echo "  (if you used --resume/--continue/--fork-session the session id may differ --" >&2
  echo "  check ~/.claude/projects/$PROJECT_SLUG/ by hand)" >&2
fi

mkdir -p "$RUN_DIR/workdir"
cp -R "$WORKDIR"/. "$RUN_DIR/workdir/"
echo "  output copied to golden-set/$SLUG/workdir/"
echo "  (the external copy at $WORKDIR_ABS is now redundant and safe to delete)"
