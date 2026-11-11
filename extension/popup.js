/**
 * Bypass Perplexity Popup - popup script
 * Runs only when the user clicks "Remove DOM/Login".
 * Injects removeLoginModalInPage() into the active tab via chrome.scripting.
 */

const removeBtn = document.getElementById("removeBtn");
const statusEl = document.getElementById("status");

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", Boolean(isError));
}

/**
 * This function is injected and executed inside the page context.
 * It must be self-contained (no closures over outer variables).
 *
 * IMPORTANT: We never remove nodes from the DOM. React manages the portal
 * container, and removing its nodes can break React's reconciliation and
 * trigger an "Internal Error" on the page. Instead we hide (display:none)
 * the pieces that visually and functionally block the page:
 *   1. The role="dialog" box itself (the login/signup UI, which now also
 *      contains the gradient "fade" that looks like a blur).
 *   2. The "fixed inset-0" wrapper that centers the dialog.
 *   3. The full-screen overlay rendered next to that wrapper. It is
 *      transparent, but it still swallows every click.
 *   4. Legacy blurred backdrops (fixed + backdrop-blur), kept for older
 *      versions of the page.
 */
function removeLoginModalInPage() {
  let hiddenCount = 0;

  const hide = (el) => {
    if (!el || el.style.display === "none") return;
    el.style.setProperty("display", "none", "important");
    hiddenCount++;
  };

  // --- Locate the login dialog(s) -------------------------------------
  // Primary: the login form is tagged with data-testid="login-modal", so
  // walk up from it to its role="dialog" container. Newer versions of the
  // page no longer set aria-modal="true" on the dialog, so we can't rely
  // on that attribute anymore.
  let dialogs = [];
  document.querySelectorAll('[data-testid="login-modal"]').forEach((marker) => {
    const dialog = marker.closest('[role="dialog"]');
    if (dialog) dialogs.push(dialog);
  });

  // Fallbacks, used only if the marker above is missing:
  //   - the older markup (aria-modal="true"),
  //   - any open dialog that sits directly inside a fixed full-screen
  //     wrapper (popovers are positioned differently, so they won't match).
  if (dialogs.length === 0) {
    document
      .querySelectorAll('div[role="dialog"][aria-modal="true"]')
      .forEach((d) => dialogs.push(d));
    document
      .querySelectorAll('div[role="dialog"][data-state="open"]')
      .forEach((d) => {
        if (d.parentElement && d.parentElement.matches(".fixed.inset-0")) {
          dialogs.push(d);
        }
      });
  }

  dialogs.forEach((dialog) => {
    // 1. The dialog box itself.
    hide(dialog);

    // 2. The fixed, full-screen wrapper that centers the dialog.
    const wrapper = dialog.closest(".fixed.inset-0");
    hide(wrapper);

    // 3. The overlay rendered right before the wrapper.
    const overlay = wrapper && wrapper.previousElementSibling;
    if (overlay && overlay.matches(".fixed.inset-0")) hide(overlay);
  });

  // Any other open full-screen overlay mounted straight under <body>
  // (Radix portals render here). Only runs when a dialog was found, so we
  // never hide unrelated overlays on pages without the login modal.
  if (dialogs.length > 0) {
    document
      .querySelectorAll('body > div.fixed.inset-0[data-state="open"]')
      .forEach(hide);
  }

  // 4. Legacy blurred backdrop (older markup). Restricted to fixed
  //    full-screen elements so regular UI using backdrop-blur is untouched.
  document.querySelectorAll('.fixed.inset-0[class*="backdrop-blur"]').forEach(hide);

  if (hiddenCount === 0) {
    return { removed: false, reason: "not-found" };
  }

  // --- Unlock the page ------------------------------------------------
  // Radix UI (visible from the "radix-_r_..." ids) locks the page by:
  //   - setting data-scroll-locked on <body>, paired with an injected rule
  //     like body[data-scroll-locked] { overflow: hidden !important; }
  //   - setting style="pointer-events: none" on <body> so nothing outside
  //     the dialog can be clicked.
  // A plain removeProperty() loses to the !important rule, so we strip the
  // lock attributes AND force the values back with !important ourselves.
  [document.documentElement, document.body].forEach((el) => {
    if (!el) return;

    el.removeAttribute("data-scroll-locked");
    el.removeAttribute("data-lenis-prevent");
    el.style.removeProperty("padding-right");
    el.style.removeProperty("margin-right");

    el.style.setProperty("overflow", "auto", "important");
    el.style.setProperty("pointer-events", "auto", "important");
  });

  return { removed: true, hiddenCount };
}

removeBtn.addEventListener("click", async () => {
  setStatus("Working...", false);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      setStatus("No active tab found.", true);
      return;
    }

    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: removeLoginModalInPage,
    });

    if (result && result.removed) {
      setStatus(`Hidden ${result.hiddenCount} element(s).`, false);
    } else {
      setStatus("No modal found on this page.", true);
    }
  } catch (err) {
    setStatus("Error: " + (err && err.message ? err.message : "unknown"), true);
  }
});
