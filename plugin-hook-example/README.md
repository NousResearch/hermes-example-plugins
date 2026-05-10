# plugin-hook-example

Reference plugin showing the `transform_llm_output` lifecycle hook.
Redacts SSN, Luhn-valid credit-card numbers, and common API-key
shapes from assistant output before it leaves the agent loop. Emits
one structured audit log line per scan so operators can see what
was caught without re-reading the text.

## What it does

Declares the `transform_llm_output` hook in `plugin.yaml`:

```yaml
hooks:
  - transform_llm_output
```

Wires it in `register(ctx)`:

```python
def register(ctx):
    ctx.register_hook(
        name="transform_llm_output",
        handler=_make_hook(ctx),
        description="Redact SSN, Luhn-valid credit cards, and API-key shapes from assistant output.",
    )
```

The hook receives the assistant's outbound text and returns the same
text with each match replaced by `[REDACTED:<kind>]`:

| Pattern | Example | Replacement |
|---|---|---|
| US SSN | `123-45-6789` | `[REDACTED:ssn]` |
| Credit card (Luhn-valid, 13-19 digits) | `4111 1111 1111 1111` | `[REDACTED:credit_card]` |
| OpenAI key | `sk-abc...` | `[REDACTED:openai_key]` |
| OpenAI project key | `sk-proj-...` | `[REDACTED:openai_project_key]` |
| Anthropic key | `sk-ant-...` | `[REDACTED:anthropic_key]` |
| AWS access key | `AKIA...`, `ASIA...` | `[REDACTED:aws_access_key]` |
| GitHub token | `ghp_...`, `gho_...`, etc. | `[REDACTED:github_token]` |

## Why this shape

The plugin is intentionally policy-only:

* No blocking, retry, or escalation - returning the redacted string is
  the whole contract.
* Patterns favour high precision over high recall. SSN refuses the
  invalid SSA blocks; credit cards must pass a Luhn check; each API
  key prefix is specific enough that a match is overwhelmingly real.
* Pure-function redaction logic in `redact.py` is unit-testable
  without any `ctx` fixture.

That keeps the example focused on the **hook lifecycle** itself
(declare, register, return transformed text) rather than the
redaction strategy, which a real deployment would replace with
Microsoft Presidio, regex catalogs, or a dedicated DLP service.

## How it works

The host calls the hook with the assistant's outbound text:

```python
def hook(text, **metadata):
    redacted, audit = redact(text)
    if not audit:
        return text
    logger.info(
        "plugin-hook-example: redacted %d span(s) from %d-char output [%s]",
        len(audit), len(text), summary,
    )
    return redacted
```

The host then sends the redacted text on to whatever channel the
user is connected through (CLI, Telegram, Discord, web UI).

Cold-path note: if the input has no matches, the hook returns the
original string unchanged and writes no log entry - so the steady
state has zero overhead.

## Audit output

A scan produces one structured log line on the standard `logging`
hierarchy:

```
INFO plugin_hook_example: redacted 2 span(s) from 1284-char output [openai_key=1, ssn=1]
```

Real audit pipelines route this through `ctx.audit.emit` or a
dedicated sink; the reference plugin keeps it on the standard
logger so it shows up in the host's log stream without any extra
wiring.

## Try it

Clone this repo (or download just this directory), drop it into
your user-plugins folder, and enable it:

```bash
git clone https://github.com/NousResearch/hermes-example-plugins.git
cp -r hermes-example-plugins/plugin-hook-example ~/.hermes/plugins/
hermes plugins enable plugin-hook-example
```

Then in a Hermes session, ask the assistant to read a file or
output that happens to contain a secret shape. The redaction
fires and the audit line shows up in the host log.

## License

MIT, same as hermes-agent.
