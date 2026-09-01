# Foundry-SR-Fix

A small Foundry VTT module that fixes a bug where the Shadowrun 5e (SR5-FoundryVTT)
roll dialog silently opens in the wrong window when a character sheet has been
popped out via the [PopOut!](https://github.com/League-of-Foundry-Developers/fvtt-module-popout)
module — making dice rolls appear to stop working once the popped-out sheet is
moved to a second monitor.

See `scripts/sr5-popout-compat.js` for a full explanation of the root cause and the fix.

## Installing this module for testing

This module is not (yet) listed in Foundry's module browser, so it needs to be
installed manually, by hand, via its manifest URL:

1. In Foundry's **Setup** screen, go to **Add-on Modules**.
2. Click **Install Module**.
3. Paste this URL into the **Manifest URL** field at the bottom of the dialog:
   `https://raw.githubusercontent.com/b4utrust/foundry-sr-fix/main/module.json`
4. Click **Install**.
5. Launch your Shadowrun 5e world, go to **Game Settings → Manage Modules**,
   and make sure both **PopOut!** and **SR5 / PopOut! Compatibility Fix** are
   checked, then save.

## Verifying the fix is active

1. Open the browser console (F12, or Ctrl+Shift+I) in your Foundry tab.
2. Reload the world.
3. Look for a line starting with `SR5 PopOut Compat |` — it should say either
   `Installed, watching for the first SR5 TestDialog to patch.` right after load,
   and then `Patched TestDialog.prototype.actor ...` the first time any character
   rolls a skill, attribute, or similar test (whether or not the sheet is popped out).
4. If you instead see `Could not find foundry.applications.instances` or
   `Active game system is ... not "shadowrun5e"`, something about your setup
   doesn't match what this module expects — let me know what it printed.

## Testing the actual bug fix

1. Open a character sheet and click PopOut! to move it into its own window.
2. Drag that window to a second monitor.
3. Roll a skill or attribute test from the popped-out sheet.
4. **Expected (fixed) behavior:** the roll dialog (edge/limit/modifiers popup)
   appears inside the popped-out window, on the second monitor, right where
   you clicked.
5. If it still appears in the main Foundry window instead, note that down —
   it means something differs from what was analyzed and the fix needs another look.
