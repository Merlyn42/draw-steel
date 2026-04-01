/**
 * Shared helpers for GM-mediated chat actions (target-based damage and effect application).
 */

/** @type {Set<string>} Tracks selectors that already have a renderChatMessageHTML hook registered. */
const _registeredSelectors = new Set();

/**
 * Register a click handler for GM action buttons inside chat messages.
 * Uses the renderChatMessageHTML hook with native event listeners.
 * Safe to call multiple times for the same selector — only registers the hook once.
 * @param {string} selector CSS selector for the button(s) to handle.
 * @param {function(HTMLButtonElement, PointerEvent): void} handler Called with the clicked button and event.
 */
export function registerGMButtonHook(selector, handler) {
  if (_registeredSelectors.has(selector)) return;
  _registeredSelectors.add(selector);

  Hooks.on("renderChatMessageHTML", (_message, html) => {
    for (const btn of html.querySelectorAll(selector)) {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        handler(btn, ev);
      });
    }
  });
}

/**
 * Escape simple HTML entities for safe interpolation into HTML strings.
 * @param {*} value The value to escape.
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[character]),
  );
}

/**
 * Serialize an object to a base64-encoded URL-safe string for use in data attributes.
 * @param {object} payload
 * @returns {string}
 */
export function encodePayload(payload) {
  return btoa(encodeURIComponent(JSON.stringify(payload)));
}

/**
 * Deserialize a payload previously encoded with {@linkcode encodePayload}.
 * @param {string} encoded
 * @returns {object}
 */
export function decodePayload(encoded) {
  return JSON.parse(decodeURIComponent(atob(encoded)));
}

/**
 * Check whether a user has owner-level permission on a token's document.
 * @param {Token} token
 * @param {User} [user=game.user]
 * @returns {boolean}
 */
export function canUserModifyToken(token, user = game.user) {
  const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  return token?.document?.testUserPermission?.(user, OWNER) ?? token?.document?.isOwner ?? false;
}

/**
 * Partition an array of tokens into those the user can modify and those they cannot.
 * @param {Token[]} tokens
 * @param {User} [user=game.user]
 * @returns {{ controllable: Token[], restricted: Token[] }}
 */
export function partitionTokensByOwnership(tokens, user = game.user) {
  const controllable = [];
  const restricted = [];

  for (const token of tokens) {
    if (!token?.document) continue;
    if (canUserModifyToken(token, user)) controllable.push(token);
    else restricted.push(token);
  }

  return { controllable, restricted };
}
