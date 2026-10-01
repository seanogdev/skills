---
name: to-markdown
description: Copy Claude's last chat reply to the clipboard as markdown that pastes cleanly into chat apps with limited markdown support, such as Slack, Teams, or Discord. Use when the user says "copy that for Slack", "clip that", "copy your last reply", "put that on my clipboard for chat", or asks for it as a block quote, with a quote marker or ">" before each line.
license: MIT
compatibility: Requires macOS (pbcopy)
---

1. Use your last chat message in this conversation.
2. Use only the prose of that message. Copy it word for word.
3. Do not use tool output. Do not use system reminders.
4. Pipe that text into `bash scripts/clip.sh`. Use a heredoc. Do not retype the text by hand.
5. Add `--quote` only when the user asks for a quote, a block quote, or a ">" before each line.
   Otherwise leave it off.
6. Do not print the result in the chat.
7. After you copy the text, tell the user.
