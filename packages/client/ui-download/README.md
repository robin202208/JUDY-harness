---
description: "Composer entry to the workspace file browser served by the login gateway."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-download

English | [中文](README.zh.md)

## Summary

A quiet pill in the composer's right-hand tool row that opens the instance's file browser in a new tab. The file browser is served by the login gateway at `/files/` and stays outside the Session UI; this package contributes only the entry point.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The entry appears next to the model and permission chips in every Session. Clicking it opens `/files/` in a new tab with `rel="noopener"`, leaving the Session untouched. The label and accessible name come from the `download` dictionary, so both locales ship with the package.

## Understand the implementation

The browser half injects `slots` and `locale`, registers its dictionary, and adds one occupant to the `conversation.input.right` list slot. The component is a plain anchor styled with semantic `--dsw-*` tokens; it reads no Session state and makes no RPC call.

## Model Experience

None, as the composer entry is presentation-only and never enters a model request.

#### KV Cache effect

None; opening the file browser does not change model requests.

## Known Limitations and Deferred Work

- The target is fixed to `/files/`; an instance that mounts the file browser elsewhere needs a different entry.
- The pill assumes the gateway serves the file browser on the same origin as the workbench.

### Dev Note

The package is registered in `packages/bundle/web-app` next to `ui-deliverables`, and its client aggregate entry lives in `tsconfig.client.json`.
