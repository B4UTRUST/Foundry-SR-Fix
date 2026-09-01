/**
 * SR5 / PopOut! Compatibility Fix
 *
 * THE BUG:
 * Clicking a roll button (skill, attribute, etc.) on a Shadowrun 5e actor sheet
 * that has been popped out (via the PopOut! module) into its own window runs
 * SuccessTest.execute(), which does a chunk of async work (populating linked
 * documents, applying effects, calculating values) BEFORE it ever creates and
 * renders the roll options dialog (SR5's `TestDialog` class).
 *
 * PopOut! decides whether a newly-opened dialog belongs to an already-popped-out
 * sheet using three checks, in order:
 *   1. Does the dialog have a `.actor` property, and does that actor have
 *      exactly one open Application (the popped-out sheet)?
 *   2. Same, but via a `.object` property instead of `.actor`.
 *   3. Fallback: was there a click inside ANY popped-out window in the last
 *      1000ms, and does the dialog's class name look like "Dialog"/"Config"/"Roll"?
 *
 * SR5's TestDialog exposes neither `.actor` nor `.object` (the actor actually
 * lives at `TestDialog.test.actor`), so checks 1 and 2 always fail. That
 * leaves check 3 as the only path -- and because of the async prep work in
 * step above, more than a second can easily pass between "user clicked Roll"
 * and "the dialog registers itself", especially on data-heavy characters.
 * When that 1-second window is missed, PopOut! renders the roll dialog in the
 * MAIN Foundry window instead of the popout. If the user is looking at the
 * popout on a second monitor, the dialog is completely out of view -- it
 * looks like the sheet just stopped responding to rolls.
 *
 * THE FIX:
 * Give TestDialog an `.actor` property that points at `this.test.actor`, the
 * same way PopOut! already expects from other systems' dialogs. This makes
 * check #1 above succeed immediately and deterministically, every time,
 * instead of depending on the flaky 1-second timing fallback.
 *
 * Because we don't control the SR5 system's source from a module, we can't
 * add a real `get actor()` getter to the TestDialog class definition directly.
 * Instead, the first time we see a TestDialog instance register itself with
 * Foundry (something PopOut! itself already relies on to detect new windows),
 * we patch that single missing getter onto TestDialog.prototype at runtime.
 * From that point on, every TestDialog instance -- including the one we just
 * saw -- has a working `.actor` property.
 */
Hooks.once("ready", () => {
    const MODULE_ID = "sr5-popout-compat";
    const LOG_PREFIX = "SR5 PopOut Compat |";

    if (game.system.id !== "shadowrun5e") {
        console.log(`${LOG_PREFIX} Active game system is "${game.system.id}", not "shadowrun5e" -- nothing to do.`);
        return;
    }

    const instances = foundry?.applications?.instances;
    if (!instances || typeof instances.set !== "function") {
        console.warn(`${LOG_PREFIX} Could not find foundry.applications.instances -- this Foundry version may be unsupported.`);
        return;
    }

    let patched = false;

    // Wrap whatever instances.set currently is (native, or already wrapped by
    // PopOut! or another module). Order relative to PopOut!'s own wrapper does
    // not matter: PopOut!'s check of app.actor happens asynchronously later
    // (after a render-state polling loop), well after this synchronous patch
    // has already run.
    const originalSet = instances.set.bind(instances);
    instances.set = function (id, app) {
        if (!patched && app?.constructor?.name === "TestDialog" && "test" in app) {
            try {
                const proto = app.constructor.prototype;
                const existing = Object.getOwnPropertyDescriptor(proto, "actor");
                if (!existing) {
                    Object.defineProperty(proto, "actor", {
                        get() {
                            return this.test?.actor;
                        },
                        configurable: true,
                    });
                    patched = true;
                    console.log(`${LOG_PREFIX} Patched TestDialog.prototype.actor -- PopOut! can now reliably detect SR5 roll dialogs.`);
                } else {
                    // Something else already defined .actor (a newer SR5 version
                    // fixed this upstream, or another module got here first).
                    // Leave it alone either way.
                    patched = true;
                    console.log(`${LOG_PREFIX} TestDialog already has an "actor" property -- skipping patch (nothing to fix).`);
                }
            } catch (err) {
                console.error(`${LOG_PREFIX} Failed to patch TestDialog.prototype.actor.`, err);
            }
        }
        return originalSet(id, app);
    };

    console.log(`${LOG_PREFIX} Installed, watching for the first SR5 TestDialog to patch.`);
});
