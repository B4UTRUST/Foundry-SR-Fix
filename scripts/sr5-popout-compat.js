/**
 * SR5 Detached Window Compatibility Fix
 *
 * =============================================================================
 * FIX 1 (primary): realm-agnostic `instanceof` for detached windows
 * =============================================================================
 *
 * THE BUG:
 * Foundry v14 can render an application in its own browser window ("Detach
 * Window"). It does this by calling `detachedDocument.adoptNode(app.element)`.
 *
 * Adopting a node into another window's document does NOT merely change its
 * ownerDocument -- the browser re-links the node's JavaScript wrapper to that
 * window's realm. Every DOM class is per-realm, so after detaching:
 *
 *     elementInDetachedWindow instanceof HTMLElement   // false!
 *
 * ...because `HTMLElement` in the system's code refers to the MAIN window's
 * HTMLElement, while the element is now an instance of the DETACHED window's
 * HTMLElement. Same name, different constructor, different realm.
 *
 * The SR5 system guards nearly every interaction handler with exactly this
 * check, e.g.:
 *
 *     static async #rollSkill(event) {
 *         event.preventDefault();
 *         if (!(event.target instanceof HTMLElement)) return;   // <-- silent bail
 *         ...
 *     }
 *
 * In a detached window that guard is always false, so the handler returns
 * silently: clicking a skill does nothing at all, with no console output.
 * At the time of writing SR5 contains 88 such realm-sensitive checks
 * (71 of them `instanceof HTMLElement`), so effectively every interactive
 * control is dead in a detached window.
 *
 * THE FIX:
 * `instanceof` is customizable via `Symbol.hasInstance`. We redefine it on the
 * main window's DOM constructors so the check first does the normal same-realm
 * test, and if that fails, re-runs the test against the equivalent constructor
 * from the object's OWN realm. An element from a detached window then correctly
 * reports as an HTMLElement, and all 88 checks start working -- without
 * modifying a single line of the SR5 system.
 *
 * This is deliberately conservative: it can only ever turn a `false` into a
 * `true`, and only for objects that genuinely are instances of the same-named
 * constructor in their own window. Non-elements still return false.
 *
 * The proper long-term fix belongs in SR5 itself (duck-type the check, or use
 * the `target` element Foundry already passes as the handler's 2nd argument).
 * This module is a drop-in stopgap until that lands upstream.
 *
 * =============================================================================
 * FIX 2 (only relevant if using the PopOut! module instead of native detach)
 * =============================================================================
 *
 * PopOut! decides whether a newly opened dialog belongs to a popped-out sheet
 * by checking `app.actor` / `app.object`, falling back to a 1-second
 * click-recency guess. SR5's TestDialog exposes neither (the actor lives at
 * `TestDialog.test.actor`), so PopOut! always falls back to that timing guess,
 * which loses the race because SuccessTest.execute() does async prep work
 * before rendering the dialog. The roll dialog then opens in the MAIN window
 * instead of the popout -- invisible if you're looking at a second monitor.
 *
 * We add the missing `actor` getter so PopOut!'s reliable path works. This is
 * only applied when the PopOut! module is actually active; with Foundry v14's
 * native detach it is unnecessary, because Foundry moves child windows itself.
 */

const LOG_PREFIX = "SR5 Detach Compat |";

/* -------------------------------------------------------------------------- */
/*  Fix 1: realm-agnostic instanceof                                          */
/* -------------------------------------------------------------------------- */

/**
 * DOM constructors SR5 uses in `instanceof` checks. Anything not present in
 * this window is skipped.
 */
const REALM_SENSITIVE_CONSTRUCTORS = [
    "EventTarget",
    "Node",
    "Element",
    "HTMLElement",
    "HTMLAnchorElement",
    "HTMLButtonElement",
    "HTMLDivElement",
    "HTMLImageElement",
    "HTMLInputElement",
    "HTMLLIElement",
    "HTMLSelectElement",
    "HTMLTextAreaElement",
    "HTMLFormElement",
    "SVGElement",
];

/**
 * Make `x instanceof <Ctor>` succeed for objects that live in another window's
 * realm (e.g. a Foundry detached window) but are instances of the same-named
 * constructor there.
 *
 * @param {string} name  Global constructor name, e.g. "HTMLElement".
 * @returns {boolean}    Whether the constructor was patched.
 */
function makeRealmAgnostic(name) {
    const Ctor = globalThis[name];
    if (typeof Ctor !== "function") return false;

    // Already patched (e.g. module reloaded) -- don't stack wrappers.
    if (Object.getOwnPropertyDescriptor(Ctor, Symbol.hasInstance)) return false;

    // The built-in OrdinaryHasInstance. Calling this directly avoids recursing
    // back into the custom hasInstance we are about to install.
    const ordinaryHasInstance = Function.prototype[Symbol.hasInstance];

    Object.defineProperty(Ctor, Symbol.hasInstance, {
        value: function (obj) {
            // Fast path: normal same-realm check.
            if (ordinaryHasInstance.call(Ctor, obj)) return true;

            if (obj === null || (typeof obj !== "object" && typeof obj !== "function")) {
                return false;
            }

            // Resolve the window that owns this object:
            //   - a Node has .ownerDocument
            //   - a Document has .defaultView
            //   - a Window has .window
            let view;
            try {
                view = obj.ownerDocument?.defaultView ?? obj.defaultView ?? obj.window;
            } catch {
                return false;
            }
            if (!view || view === globalThis) return false;

            const ForeignCtor = view[name];
            if (typeof ForeignCtor !== "function") return false;

            // Test against the foreign realm's constructor using the built-in
            // algorithm, so a custom hasInstance over there can't interfere.
            try {
                return ordinaryHasInstance.call(ForeignCtor, obj);
            } catch {
                return false;
            }
        },
        configurable: true,
        writable: false,
    });

    return true;
}

Hooks.once("init", () => {
    if (game.system.id !== "shadowrun5e") {
        console.log(`${LOG_PREFIX} System is "${game.system.id}", not "shadowrun5e" -- standing down.`);
        return;
    }

    const patched = REALM_SENSITIVE_CONSTRUCTORS.filter(makeRealmAgnostic);
    console.log(
        `${LOG_PREFIX} Made ${patched.length} DOM constructors realm-agnostic so SR5's ` +
        `"instanceof" guards work in detached windows.`,
        patched
    );
});

/* -------------------------------------------------------------------------- */
/*  Fix 2: PopOut! dialog ownership (only when PopOut! is active)              */
/* -------------------------------------------------------------------------- */

Hooks.once("ready", () => {
    if (game.system.id !== "shadowrun5e") return;

    if (!game.modules.get("popout")?.active) {
        console.log(`${LOG_PREFIX} PopOut! is not active -- skipping its dialog-ownership patch (not needed for native detach).`);
        return;
    }

    const instances = foundry?.applications?.instances;
    if (!instances || typeof instances.set !== "function") {
        console.warn(`${LOG_PREFIX} foundry.applications.instances unavailable -- skipping PopOut! patch.`);
        return;
    }

    let patched = false;

    // SR5 does not export TestDialog, so we cannot reference the class directly.
    // Instead we grab it off the first instance that registers itself, then patch
    // its prototype so every instance (including that one) gains the getter.
    // Registration happens during render(), so `test` is already assigned.
    const originalSet = instances.set.bind(instances);
    instances.set = function (id, app) {
        if (!patched && app?.constructor?.name === "TestDialog" && "test" in app) {
            try {
                const proto = app.constructor.prototype;
                if (!Object.getOwnPropertyDescriptor(proto, "actor")) {
                    Object.defineProperty(proto, "actor", {
                        get() {
                            return this.test?.actor;
                        },
                        configurable: true,
                    });
                    console.log(`${LOG_PREFIX} Patched TestDialog.prototype.actor for PopOut! dialog detection.`);
                } else {
                    console.log(`${LOG_PREFIX} TestDialog already exposes "actor" -- no patch needed.`);
                }
                patched = true;
            } catch (err) {
                console.error(`${LOG_PREFIX} Failed to patch TestDialog.prototype.actor.`, err);
            }
        }
        return originalSet(id, app);
    };

    console.log(`${LOG_PREFIX} PopOut! detected -- watching for the first SR5 TestDialog.`);
});
