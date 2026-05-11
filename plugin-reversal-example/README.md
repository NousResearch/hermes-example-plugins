# Reversal + Hermes integration example

This example shows how to normalize messy sources before they reach Hermes.

## Why

Hermes is stronger when input data is clean.
Reversal converts raw inputs (URL, PDF, Word, Excel, CSV, image, text) into a stable JSON schema.

## Install

pip install reversal-engine

Optional (only for image/dashboard parsing):
export ANTHROPIC_API_KEY=your_key_here

## Run

python plugin-reversal-example/reversal_integration.py "https://example.com"

## How to use in your Hermes flow

1. Call normalize_for_hermes(source)
2. Build prompt/tool input with build_hermes_input(...)
3. Send that normalized payload to Hermes instead of raw source content
