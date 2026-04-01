import DSRoll from "./base.mjs";
import DrawSteelChatMessage from "../documents/chat-message.mjs";
import { decodePayload, encodePayload, escapeHtml, partitionTokensByOwnership, registerGMButtonHook } from "../utils/gm-action.mjs";

/**
 * A roll subclass with damage-specific info like damage type.
 */
export default class DamageRoll extends DSRoll {
  /**
   * Apply this roll's result to a single actor.
   * @param {DrawSteelActor} actor
   * @param {object} params
   * @param {number} params.amount
   * @param {boolean} params.isHealing
   * @param {boolean} params.applyToTemporary
   * @param {string|null} params.rollType
   * @param {string[]} params.ignoredImmunities
   */
  static async _applyResultToActor(actor, { amount, isHealing, applyToTemporary, rollType, ignoredImmunities }) {
    if (!actor) return;

    if (isHealing) {
      if (applyToTemporary && (amount < actor.system.stamina.temporary)) {
        ui.notifications.warn("DRAW_STEEL.ChatMessage.base.Buttons.ApplyHeal.TempCapped", { format: { name: actor.name } });
        return;
      }

      const attribute = applyToTemporary ? "stamina.temporary" : "stamina";
      await actor.modifyTokenAttribute(attribute, amount, !applyToTemporary, !applyToTemporary);
      return;
    }

    await actor.system.takeDamage(amount, {
      type: rollType,
      ignoredImmunities,
    });
  }

  /**
   * Button callback to apply damage to targeted actors.
   * @param {PointerEvent} event
   */
  static async applyDamageCallback(event) {
    if (!game.user?.targets?.size) return void ui.notifications.error("DRAW_STEEL.ROLL.Damage.NoTokenTargeted", { localize: true });

    /** @type {HTMLButtonElement} */
    const target = event.currentTarget;

    const part = target.closest("[data-message-part]");
    const li = target.closest("[data-message-id]");
    if (!li) return;

    const message = game.messages.get(li.dataset.messageId);
    if (!message) return;

    const idx = Number(target.dataset.index);
    /** @type {DamageRoll} */
    const roll = part ? message.system.parts.get(part.dataset.messagePart)?.rolls[idx] : message.rolls[idx];
    if (!roll) return;

    await roll.applyDamage(null, { halfDamage: event.shiftKey });
  }

  /* -------------------------------------------------- */

  /**
   * The damage type.
   * @type {string}
   */
  get type() {
    return this.options.type ?? (this.isHeal ? "value" : "");
  }

  /* -------------------------------------------------- */

  /**
   * The localized label for this damage roll's type.
   * @type {string}
   */
  get typeLabel() {
    if (this.isHeal) return ds.CONFIG.healingTypes[this.type]?.label;
    return ds.CONFIG.damageTypes[this.type]?.label ?? "";
  }

  /* -------------------------------------------------- */

  /**
   * Damage immunities to ignore.
   * @type {string[]}
   */
  get ignoredImmunities() {
    return this.options.ignoredImmunities ?? [];
  }

  /* -------------------------------------------------- */

  /**
   * Does this represent healing?
   * @type {boolean}
   */
  get isHeal() {
    return this.options.isHeal || false;
  }

  /* -------------------------------------------------- */

  /**
   * Produces a button with relevant data to applying this damage.
   * @param {number} index The index of this roll in the `rolls` array of the message.
   * @returns {HTMLButtonElement} A button that.
   */
  toRollButton(index) {
    const labelPath = this.isHeal ? "DRAW_STEEL.ChatMessage.base.Buttons.ApplyHeal.Label" : "DRAW_STEEL.ChatMessage.base.Buttons.ApplyDamage.Label";

    const tooltipPath = this.isHeal ? "DRAW_STEEL.ChatMessage.base.Buttons.ApplyHeal.Tooltip" : "DRAW_STEEL.ChatMessage.base.Buttons.ApplyDamage.Tooltip";

    return ds.utils.constructHTMLButton({
      label: _loc(labelPath, {
        type: this.typeLabel ? " " + this.typeLabel : "",
        amount: this.total,
      }),
      dataset: {
        action: "applyDamage",
        index,
        tooltip: _loc(tooltipPath),
        tooltipDirection: "UP",
      },
      classes: ["apply-damage"],
      icon: this.isHeal ? "fa-solid fa-heart-pulse" : "fa-solid fa-burst",
    });
  }

  /* -------------------------------------------------- */

  /**
   * Apply this roll's damage to targeted actors, whispering the GM for unowned tokens.
   * @param {DrawSteelActor[]} [_targets]   Ignored — always uses game.user.targets.
   * @param {object} [options={}]           Options that modify the damage application.
   * @param {boolean} [options.halfDamage]  Only apply half the total damage.
   */
  async applyDamage(_targets, options = {}) {
    const rawAmount = this.total;
    const amount = options.halfDamage ? Math.floor(rawAmount / 2) : rawAmount;
    const targetedTokens = [...game.user.targets].filter((token) => token?.document && token.actor);
    if (!targetedTokens.length) return void ui.notifications.error("DRAW_STEEL.ROLL.Damage.NoTokenTargeted", { localize: true });

    const isHealing = Boolean(this.isHeal);
    const applyToTemporary = isHealing && (this.type !== "value");
    const rollType = this.type ?? null;
    const ignoredImmunities = this.ignoredImmunities;

    const { controllable, restricted } = partitionTokensByOwnership(targetedTokens, game.user);

    const ownedActors = new Map();
    for (const token of controllable) {
      const actor = token.actor;
      if (!actor) continue;
      const key = actor.uuid ?? actor.id ?? token.id;
      if (!ownedActors.has(key)) ownedActors.set(key, actor);
    }

    for (const actor of ownedActors.values()) {
      await DamageRoll._applyResultToActor(actor, {
        amount,
        isHealing,
        applyToTemporary,
        rollType,
        ignoredImmunities,
      });
    }

    for (const token of restricted) {
      await DamageRoll._whisperGMApplyButton({
        sceneId: token.document.parent?.id ?? token.scene?.id,
        tokenId: token.id,
        tokenName: token.name,
        amount,
        isHealing,
        applyToTemporary,
        rollType,
        ignoredImmunities,
      });
    }
  }

  /* -------------------------------------------------- */

  /**
   * Send a whisper to all GMs containing a button to apply damage on behalf of a non-owner.
   * @param {object} params
   * @param {string} params.sceneId
   * @param {string} params.tokenId
   * @param {string} params.tokenName
   * @param {number} params.amount
   * @param {boolean} params.isHealing
   * @param {boolean} params.applyToTemporary
   * @param {string|null} params.rollType
   * @param {string[]} params.ignoredImmunities
   */
  static async _whisperGMApplyButton({ sceneId, tokenId, tokenName, amount, isHealing, applyToTemporary, rollType, ignoredImmunities }) {
    const gmIds = game.users.filter((user) => user.isGM).map((user) => user.id);
    if (!gmIds.length) return;

    const payload = {
      sceneId,
      tokenId,
      amount,
      isHealing,
      applyToTemporary,
      rollType,
      ignoredImmunities,
    };

    const safeName = escapeHtml(tokenName);
    const label = isHealing
      ? (applyToTemporary ? _loc("DRAW_STEEL.UI.ApplyTempHeal")
        : _loc("DRAW_STEEL.UI.ApplyHeal"))
      : _loc("DRAW_STEEL.UI.ApplyDamage");

    const requestLine = _loc("DRAW_STEEL.UI.RequestGMApplyLine");
    const changeLabel = isHealing
      ? (applyToTemporary ? _loc("DRAW_STEEL.UI.ChangeTypeTempHeal") : _loc("DRAW_STEEL.UI.ChangeTypeHeal"))
      : _loc("DRAW_STEEL.UI.ChangeTypeDamage");
    const rollTypeSuffix = !isHealing && rollType ? ` (${escapeHtml(rollType)})` : "";

    const content = `
      <div class="ds-gm-apply">
        <p><strong>${requestLine}</strong> ${safeName}</p>
        <p>${changeLabel}: <strong>${amount}</strong>${rollTypeSuffix}</p>
        <button type="button"
          class="ds-apply-damage-gm"
          data-ds='${encodePayload(payload)}'>
          ${label}
        </button>
      </div>
    `;

    await DrawSteelChatMessage.create({
      content,
      whisper: gmIds,
      style: CONST.CHAT_MESSAGE_STYLES.OOC,
    });
  }
}

/* -------------------------------------------------- */

registerGMButtonHook(".ds-apply-damage-gm", async (btn) => {
  try {
    if (!game.user.isGM) {
      return ui.notifications.warn("DRAW_STEEL.UI.GMOnly", { localize: true });
    }
    const encoded = btn.dataset.ds;
    if (!encoded) return;

    const data = decodePayload(encoded);
    const scene = game.scenes.get(data.sceneId) ?? canvas?.scene;
    const tokenDoc = scene?.tokens?.get(data.tokenId) ?? canvas?.tokens?.get(data.tokenId)?.document;
    if (!tokenDoc) {
      return ui.notifications.error("DRAW_STEEL.UI.TokenNotFound", { localize: true });
    }

    const actor = tokenDoc.actor;
    if (!actor) {
      return ui.notifications.error("DRAW_STEEL.UI.ActorNotFound", { localize: true });
    }

    const amount = Number(data.amount) || 0;
    const isHealing = Boolean(data.isHealing);
    const applyToTemporary = Boolean(data.applyToTemporary);
    const rollType = data.rollType ?? null;
    const ignoredImmunities = Array.isArray(data.ignoredImmunities) ? data.ignoredImmunities : [];

    await DamageRoll._applyResultToActor(actor, {
      amount,
      isHealing,
      applyToTemporary,
      rollType,
      ignoredImmunities,
    });

    btn.disabled = true;
    btn.textContent = _loc("DRAW_STEEL.UI.Applied");
  } catch (err) {
    console.error(err);
    ui.notifications.error("DRAW_STEEL.UI.ApplyFailed", { localize: true });
  }
});
