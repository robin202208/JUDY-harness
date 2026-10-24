---
description: "A composer toggle that hides the model, permission, and agent-preset chips behind a simple default."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-simple-mode

English | [中文](README.zh.md)

## Summary

One text toggle in the composer's right-hand tool row. Simple mode is the default for a first visit: the model, permission, and agent-preset chips disappear from the composer, leaving a cleaner surface. The preference is browser-local; it never reaches the Host or the Session log.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The toggle shows "显示高级选项" while simple mode is on and "隐藏高级选项" while it is off. Switching writes `judy.ui.simple` to `localStorage` and toggles `data-judy-simple` on the document element; the package stylesheet then hides every `[data-judy-chip]` control. The chips keep working while hidden, and any code that sets the attribute can hide a new chip.

## Understand the implementation

The browser half injects `slots` and `locale`, restores the stored flag on load, and registers the toggle into `conversation.input.right`. Hiding is pure CSS keyed on the document attribute, so no component needs to know which chips exist and no Session state is involved.

## Model Experience

None, as hiding composer chips is presentation-only and never enters a model request.

#### KV Cache effect

None; the stored preference does not change model requests.

## Known Limitations and Deferred Work

- Only controls that carry `data-judy-chip` are hidden; a new chip must opt in.
- A stored preference is per browser, not per account.

### Dev Note

Chip owners add `data-judy-chip` to their trigger; the model, permission, and agent-preset packages already do.
