# Foundry-SR-Fix

A small Foundry VTT module that makes **Shadowrun 5e (SR5-FoundryVTT)** character
sheets work correctly in a **detached / popped-out browser window**.

Verified against Foundry **14.367**, SR5 **0.36.3**.

## The bugs this fixes

### 1. Sheet controls dead in a detached window (the main one)

Foundry v14's native **Detach Window** moves a sheet into its own browser window
via `adoptNode()`. Adopting a node into another window doesn't just change its
`ownerDocument` — the browser **re-links it to that window's JavaScript realm**.
Every DOM class is per-realm, so from the main window's point of view:

```js
elementInDetachedWindow instanceof HTMLElement   // false
```

SR5 guards nearly every interaction handler with exactly that check:

```js
static async #rollSkill(event) {
    event.preventDefault();
    if (!(event.target instanceof HTMLElement)) return;   // silent bail
```

There are **88** such realm-sensitive checks in SR5 (71 of them
`instanceof HTMLElement`), so in a detached window clicking a skill — and most
other controls — does nothing at all, with no console error.

This module redefines `Symbol.hasInstance` on the main window's DOM
constructors so the check falls back to the object's *own* realm. All 88 checks
start working, with no changes to the SR5 system itself.

It can only ever turn a `false` into a `true`, and only for objects that really
are instances of the same-named constructor in their own window. Non-elements
still return `false`.

### 2. Roll dialog opens in the wrong window (PopOut! module only)

The [PopOut!](https://github.com/League-of-Foundry-Developers/fvtt-module-popout)
module decides whether a new dialog belongs to a popped-out sheet by checking
`app.actor` / `app.object`, falling back to a 1-second click-recency guess.
SR5's `TestDialog` exposes neither (the actor lives at `TestDialog.test.actor`),
so PopOut! always falls back to that timing guess — and loses the race, because
`SuccessTest.execute()` does async prep work before rendering the dialog. The
roll dialog then opens in the main window, invisible if you're looking at a
second monitor.

This module adds the missing `actor` getter. It is **only applied when PopOut!
is active**; with native detach it isn't needed, since Foundry moves child
windows itself.

> **Recommended:** use Foundry v14's built-in **Detach Window** control (in the
> sheet's window header) rather than the PopOut! module. PopOut! is verified
> only to Foundry 13.350 and does manual cross-document DOM surgery that
> duplicates — and conflicts with — v14's native window management.

## Installing

1. In Foundry's **Setup** screen, go to **Add-on Modules** → **Install Module**.
2. Paste this into the **Manifest URL** field:
   `https://raw.githubusercontent.com/B4UTRUST/Foundry-SR-Fix/main/module.json`
3. Click **Install**.
4. In your world: **Game Settings → Manage Modules**, enable
   **SR5 Detached Window Compatibility Fix**, and save.

## Verifying it's active

Open the console (F12) and reload the world. You should see:

```
SR5 Detach Compat | Made N DOM constructors realm-agnostic so SR5's "instanceof" guards work in detached windows.
```

If instead you see `System is "..." not "shadowrun5e" -- standing down.`, the
module is installed in a non-SR5 world and is intentionally doing nothing.

## Testing

1. Open a character sheet, click **Detach Window** in its header, and move the
   window to your second monitor.
2. Click a **skill** icon → the roll dialog should appear.
3. Click an **attribute** → should also still work.
4. Close the sheet and reopen it → should reopen normally.

## Upstream fix

The real fix belongs in SR5: those `instanceof` checks should be realm-safe —
either duck-typed (`node?.nodeType === 1`), or simply using the `target` element
Foundry already passes as the action handler's second argument. This module is a
stopgap until that lands upstream.
