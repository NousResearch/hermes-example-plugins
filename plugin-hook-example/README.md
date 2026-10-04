# plugin-hook-example

Reference plugin for the lifecycle-hook surface, `ctx.register_hook()`. One
`transform_llm_output` callback masks US Social Security numbers and
Luhn-valid card numbers in the turn's final assistant text.

Read it alongside the [Event Hooks reference](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks#transform_llm_output).

## The whole surface

```yaml
# plugin.yaml
hooks:
  - transform_llm_output
```

```python
# __init__.py
def _on_llm_output(response_text="", session_id="", platform="", **_):
    masked, counts = redact(response_text)
    if not counts:
        return None          # unchanged: let other plugins' transforms run
    return masked            # non-empty string replaces the final text

def register(ctx):
    ctx.register_hook("transform_llm_output", _on_llm_output)
```

| Rule | Why |
|---|---|
| Positional `ctx.register_hook(name, callback)` | That is the signature. |
| Callback takes keyword args and `**_` | Hermes calls hooks with keywords only and adds fields over time. |
| Return `None` when nothing changed | The first non-empty string across all plugins wins; echoing the input back would claim the turn. |
| Log counts, never the matched values | The log is a second copy of whatever you just masked. |

## What gets masked

| Pattern | Example | Replacement |
|---|---|---|
| US SSN, dashed | `123-45-6789` | `[REDACTED:ssn]` |
| Luhn-valid card, grouped 4-4-4-4 or 4-6-5 (one consistent space or hyphen), or 15-16 digits run together | `4111 1111 1111 1111 12/25` | `[REDACTED:card] 12/25` |

The fixed group shapes keep a trailing expiry or CVV out of the match and leave
13-digit timestamps and 17-19 digit IDs alone. Out of scope, on purpose:
undashed SSNs, irregular spacing, and Luhn-valid numbers that only look like
cards (roughly 1 in 10 random 16-digit numbers pass Luhn). A real deployment
would put a DLP library behind the same hook.

API keys and tokens are not handled here on purpose: core already redacts
them, and a plugin that needs extra secret shapes should add them with
`ctx.register_redaction_patterns()`, not a hook.

## When it runs

Once per turn, after the tool loop, before the assistant row is persisted
and before final delivery. The masked text is what the session stores, what
`/resume` shows and what the next turn replays. With CLI streaming on, the
original tokens have already been streamed; Hermes prints the replacement
after the streamed body, labeled as a post-stream transformation. Treat this
as a transcript and delivery filter, not a guarantee the model's raw output
was never on screen.

## Try it

```bash
git clone https://github.com/NousResearch/hermes-example-plugins.git
cp -r hermes-example-plugins/plugin-hook-example ~/.hermes/plugins/
hermes plugins enable plugin-hook-example
```

Ask the assistant to repeat `my SSN is 123-45-6789`. The stored reply reads
`[REDACTED:ssn]`, and the agent log (`hermes logs`) shows
`plugin-hook-example: masked ssn=1 in session <id> (cli)`.
