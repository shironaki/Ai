# Autonomous QA loop

The isolated Telethon QA account is controlled through GitHub Issue #27. The Termux supervisor can keep the QA agent alive when `~/.config/ai/qa_agent.env` exists.

One-time phone setup:
1. Ensure the existing QA Telethon venv/session remains at `~/Ai/qa_client/.venv` and `~/.config/ai/qa_client/founder_qa.session`.
2. Create `~/.config/ai/qa_agent.env` with the existing Telethon API hash, for example `QA_API_HASH=...`, and optionally `QA_TARGET=AiAether1_Bot`.
3. Pull the branch update and restart the Termux supervisor once.

After that, the development loop is autonomous: assistant posts `RUN ...` to Issue #27 -> QA account sends messages -> results return to Issue #27 -> assistant inspects responses/logs -> fixes code -> CI -> reruns QA.

Never commit API hashes or Telegram session files.