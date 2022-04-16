class AdvancedAutomation {
  static ID = 'pf2e-advanced-automation';

  static FLAGS = {
    EFFECT: 'automated-effect',
  };

  static TYPEIMAGES = {
    bleed: 'systems/pf2e/icons/spells/blood-vendetta.webp',
    fire: 'systems/pf2e/icons/spells/produce-flame.webp',
    acid: 'systems/pf2e/icons/spells/cloudkill.webp',
    cold: 'systems/pf2e/icons/spells/clinging-ice.webp',
    electricity: 'icons/magic/lightning/bolt-strike-purple-pink.webp',
    force: 'systems/pf2e/icons/spells/magic-missile.webp',
    mental: 'systems/pf2e/icons/spells/modify-memory.webp',
    sonic: 'systems/pf2e/icons/spells/cry-of-destruction.webp',
    poison: 'icons/magic/nature/root-vine-thorns-poison-green.webp',
    lawful: 'systems/pf2e/icons/equipment/adventuring-gear/merchant-scale.webp',
    chaotic: 'systems/pf2e/icons/spells/prismatic-wall.webp',
    good: 'systems/pf2e/icons/spells/angelic-messenger.webp',
    evil: 'systems/pf2e/icons/spells/daemonic-pact.webp',
    positive: 'systems/pf2e/icons/spells/positive-luminance.webp',
    negative: 'systems/pf2e/icons/spells/bind-soul.webp',
    //healing: 'systems/pf2e/icons/spells/life-siphon.webp',
  };

  static TEMPLATES = {
    EFFECTWINDOW: `modules/${this.ID}/templates/persistent-window.hbs`,
  };

  static SETTINGS = {
    BATCH_PROCESS_ACTORS: 'batch-process-actors',
  };

  /**
   * A small helper function which leverages developer mode flags to gate debug logs.
   *
   * @param  {...any} args - what to log
   */
  static log(...args) {
    const shouldLog = game.modules.get('_dev-mode')?.api?.getPackageDebugValue(this.ID);

    if (shouldLog) {
      console.log(this.ID, '|', ...args);
    }
  }

  /**
   *
   * @param {object} tokenPF2e
   * @param {array} InstanceArray
   * @returns
   */
  static calculateHealthChange(tokenPF2e, InstanceArray) {
    //AdvancedAutomation.log(InstanceArray);
    const actorTraits = tokenPF2e.actor.data.data.traits;
    let output = [];

    for (let index = 0; index < InstanceArray.length; index++) {
      const instance = InstanceArray[index];
      let DR = actorTraits.dr.find((c) => c.type == instance.type)?.value ?? 0;
      let DV = actorTraits.dv.find((c) => c.type == instance.type)?.value ?? 0;
      let sum = instance.value;

      sum -= Math.min(DR, instance.value);
      if (sum > 0) sum += DV;

      output.push({
        totalChange: sum,
        resistValue: Math.min(DR, instance.value),
        weakValue: DV,
        immune: false,
      });
    }

    return output;
  }

  static _initialize() {
    game.settings.register(this.ID, this.SETTINGS.BATCH_PROCESS_ACTORS, {
      config: true,
      default: true,
      hint: `Process the persistant effects on all copy's of an actor on any copy's turn`,
      name: `Batch Process Actors`,
      scope: 'world',
      type: Boolean,
    });
  }
}

Hooks.once('init', () => {
  AdvancedAutomation._initialize();
  AutomatedEffect._initialize();
});

/**
 * Register the module's debug flag with developer mode's custom hook
 */
Hooks.once('devModeReady', ({ registerPackageDebugFlag }) => {
  registerPackageDebugFlag(AdvancedAutomation.ID);
});

/**
 * @typedef {object} effectFlags
 * @property {string} type
 * @property {string} dieFormula
 * @property {number} difficultyClass
 * @property {boolean} isEndOfTurn
 * @property {boolean} isHealing
 * @property {number} duration - the duration of the effect in rounds
 * @property {object} ruleElements - rule element object to apply to the effect
 */

class AutomatedEffect {
  /**
   *
   * @param {string} tokenId - id of the token to add this Effect to
   * @param {effectFlags} effectFlags - the effect data to use
   * @param {boolean} [shouldForce] - if true always adds a new effect regardless of any current effects
   */
  static async create(tokenId, effectFlags, shouldForce) {
    if (!effectFlags.type || !Roll.validate(effectFlags.dieFormula)) {
      ui.notifications.warn('Invalid Effect');
      return;
    }

    /**
     *
     */
    const CLEAN_DATA = {
      type: effectFlags.type.toLowerCase(),
      dieFormula: effectFlags.dieFormula.toLowerCase(),
      difficultyClass: Math.min(effectFlags.difficultyClass, 255) ?? 15,
      isEndOfTurn: effectFlags.isEndOfTurn ?? true,
      isHealing: effectFlags.isHealing ?? false,
      duration: Math.min(effectFlags.duration, 52564442400) ?? 0,
      ruleElements: effectFlags.ruleElements ?? [],
    };

    let currentEffect = this.retrieve(canvas.tokens.get(tokenId)).find(
      (c) => c.data.flags[AdvancedAutomation.ID][AdvancedAutomation.FLAGS.EFFECT]?.type == CLEAN_DATA.type
    );

    if (currentEffect) {
      if (!shouldForce) {
        const CURRENT_DATA = currentEffect.data.flags[AdvancedAutomation.ID][AdvancedAutomation.FLAGS.EFFECT];
        let currentAmount = await new Roll(CURRENT_DATA.dieFormula).evaluate({ maximize: true }).total;
        let newAmount = await new Roll(CLEAN_DATA.dieFormula).evaluate({ maximize: true }).total;

        if (newAmount > currentAmount || CLEAN_DATA.difficultyClass > CURRENT_DATA.difficultyClass) {
          if (newAmount >= currentAmount && CLEAN_DATA.difficultyClass >= CURRENT_DATA.difficultyClass) {
            AdvancedAutomation.log('Automatic Replacement:', 'Replace');
            AutomatedEffect.delete(currentEffect);
          } else {
            AdvancedAutomation.log('Automatic Replacement:', 'Prompt');
            if (await _prompt(CURRENT_DATA, CLEAN_DATA)) return;
          }
        } else {
          AdvancedAutomation.log('Automatic Replacement:', 'Ignore');
          return;
        }
      }
    }

    async function _prompt(oldData, newData) {
      let ignore = false;
      function _handleInput(doReplace) {
        if (doReplace) {
          AutomatedEffect.delete(currentEffect);
          return;
        }
        ignore = true;
      }

      await Dialog.confirm({
        title: 'Replace Effect?',
        content: `<p>Current Effect: ${oldData.dieFormula} DC ${oldData.difficultyClass}</p><p>New Effect: ${newData.dieFormula} DC ${newData.difficultyClass}<p>`,
        yes: () => _handleInput(true),
        no: () => _handleInput(false),
        defaultYes: false,
      });
      return ignore;
    }

    /**
     *
     * @param {effectFlags} effectFlags effectFlags
     * @returns {string} formatted name of the effect
     */
    function _createTitle(effectFlags) {
      const { type, dieFormula, difficultyClass } = effectFlags;
      const dcStr = difficultyClass == 15 ? '' : ` DC${String(difficultyClass)}`;
      const kind = !effectFlags.isHealing ? 'damage' : 'healing';
      return `Persistent ${kind} (${String(dieFormula.toUpperCase())} ${type}${dcStr})`;
    }

    /**
     *F
     * @param {effectFlags} effectFlags effectFlags
     * @returns {object} foundry ready effect item data
     */
    function _createItemData(effectFlags) {
      return {
        type: 'effect',
        name: _createTitle(effectFlags),
        data: {
          description: {
            value: 'Automated Persistent Effect.',
          },
          duration: {
            expiry: effectFlags.isEndOfTurn == true ? 'turn-end' : 'turn-begin',
            unit: effectFlags.duration > 0 ? 'rounds' : 'unlimited',
            value: effectFlags.duration,
            sustained: false,
          },
          rules: effectFlags.ruleElements,
          tokenIcon: {
            show: true,
          },
        },
        img: AdvancedAutomation.TYPEIMAGES[effectFlags.type.toLowerCase()],
      };
    }

    const created = await canvas.tokens
      .get(tokenId)
      .actor.createEmbeddedDocuments('Item', [_createItemData(CLEAN_DATA)]);
    await created[0].setFlag(AdvancedAutomation.ID, AdvancedAutomation.FLAGS.EFFECT, CLEAN_DATA);
  }

  /**
   *
   */
  static _initialize() {
    this.window = new AutomatedEffectWindow();
    $(document).on('click', 'button.automated-effets.player-save-button', function () {
      AutomatedEffect.playerSave($(this).data('token-id'), $(this).data('effect-id'));
    });
  }

  /**
   *
   * @param {TokenPF2e} token
   * @param {boolean} [onTurnEnd]
   * @returns {array} array of effects that are on the actor
   */
  static retrieve(token, onTurnEnd) {
    let actor = token.actor;
    //AdvancedAutomation.log('retrieve', turnEnd);
    if (onTurnEnd != undefined) {
      let effects = actor.items.filter(
        (item) =>
          item.type === 'effect' &&
          item.data.flags[AdvancedAutomation.ID][AdvancedAutomation.FLAGS.EFFECT]?.isEndOfTurn == onTurnEnd
      );
      //AdvancedAutomation.log(effects);
      return effects;
    }
    let effects = actor.items.filter(
      (item) => item.type === 'effect' && item.data.flags[AdvancedAutomation.ID][AdvancedAutomation.FLAGS.EFFECT]
    );
    //AdvancedAutomation.log(effects);
    return effects;
  }

  /**
   *
   * @param {effectItem} effect
   * @returns
   */
  static delete(effect) {
    return effect.delete();
  }

  /**
   *
   * @param {string} tokenId
   * @param {string} effectItemId
   */
  static async playerSave(tokenId, effectItemId) {
    AdvancedAutomation.log('save button clicked');

    let effectArray = AutomatedEffect.retrieve(canvas.tokens.get(tokenId));
    let effectItem = effectArray.find((c) => c.id == effectItemId);

    if (!effectItem) {
      ui.notifications.warn('You already saved on this effect');
      return;
    }
    const effectFlags = effectItem.data.flags[AdvancedAutomation.ID][AdvancedAutomation.FLAGS.EFFECT];
    const saveRoll = new Roll('1d20');

    const messageData = await saveRoll.toMessage({}, { create: false });
    messageData.flavor = `DC: ${effectFlags.difficultyClass}`;

    const message = await ChatMessage.create(messageData);

    function waitFor3DDiceMessage(targetMessageId) {
      function buildHook(resolve) {
        Hooks.once('diceSoNiceRollComplete', (messageId) => {
          if (targetMessageId === messageId) resolve(true);
          else buildHook(resolve);
        });
      }
      return new Promise((resolve, reject) => {
        if (game.dice3d) {
          buildHook(resolve);
        } else {
          resolve(true);
        }
      });
    }

    await waitFor3DDiceMessage(message.id);
    if (saveRoll.total >= effectFlags.difficultyClass) this.delete(effectItem);
  }

  /**
   *
   * @param {TokenPF2e} TokenPF2e
   * @param {effectItem} effectItem
   *
   */
  static async process(tokenPF2e, effectItem) {
    //AdvancedAutomation.log(tokenPF2e, effectFlags);
    const DATA = effectItem.data.flags[AdvancedAutomation.ID][AdvancedAutomation.FLAGS.EFFECT];
    //AdvancedAutomation.log(DATA);
    const DICEROLL = await new Roll(DATA.dieFormula).roll({ async: true });
    //AdvancedAutomation.log(DICEROLL);
    const isNPC = !tokenPF2e.actor.hasPlayerOwner;
    AdvancedAutomation.log('Processing an NPC:', isNPC);

    let healthInfo = AdvancedAutomation.calculateHealthChange(tokenPF2e, [
      { type: DATA.type, value: DICEROLL.total },
    ])[0];

    let html = `
    <p class=action-content>${tokenPF2e.name} ${DATA.isHealing ? 'receives' : 'takes'} ${
      healthInfo.totalChange
    } persistant ${DATA.type} ${DATA.isHealing ? 'healing' : 'damage'}</p>
    ${isNPC ? '<div class="automated-effets gm-info" data-visibility="gm">' : ''}
    ${healthInfo.resistValue > 0 ? `<p class=action-content>${healthInfo.resistValue} Resisted</p>` : ''}
    ${healthInfo.weakValue > 0 ? `<p class=action-content>${healthInfo.weakValue} Weakness</p>` : ''}
    ${
      !isNPC
        ? `
        <div class="message-buttons" data-visibility="all">
        <button name="savebutton" data-effect-id="${effectItem.id}" data-token-id="${tokenPF2e.id}" class="automated-effets player-save-button">
        Roll Save
        </button>
        </div>
        `
        : ''
    }
    ${isNPC ? `<p class=action-content>NPC Save Roll: ${_NPCSave()}</p> </div>` : ''}
    `;

    function _NPCSave() {
      const saveRoll = new Roll('1d20').roll({ async: false });
      if (saveRoll.total >= DATA.difficultyClass) AutomatedEffect.delete(effectItem);
      return saveRoll.total;
    }

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: tokenPF2e.actor }),
      content: html,
      type: 3,
    });

    let tempHP = tokenPF2e.actor.data.data.attributes.hp.temp;

    if (tempHP > 0) {
      if (tempHP >= healthInfo.totalChange) {
        await tokenPF2e.actor.update({
          'data.attributes.hp.temp': tokenPF2e.actor.data.data.attributes.hp.temp - healthInfo.totalChange,
        });
        return;
      }
      healthInfo.totalChange -= tempHP;
      await tokenPF2e.actor.update({
        'data.attributes.hp.temp': 0,
      });
    }

    await tokenPF2e.actor.update({
      'data.attributes.hp.value': tokenPF2e.actor.data.data.attributes.hp.value - healthInfo.totalChange,
    });

    //if (effect.data.data.expired) AutomatedEffect.delete(tokenPF2e, effect);
  }

  /**
   *
   * @param {string} actorID
   * @param {boolean} onTurnEnd
   */
  static async massProcessAllEffects(actorID, onTurnEnd) {
    const tokenArray = canvas.tokens.placeables.filter((c) => c.data.actorId == actorID);
    //AdvancedAutomation.log(tokenArray);

    for (let actorIndex = 0; actorIndex < tokenArray.length; actorIndex++) {
      let effectArray = AutomatedEffect.retrieve(tokenArray[actorIndex], onTurnEnd);
      //AdvancedAutomation.log(effectArray);
      if (effectArray.length < 1) continue;

      for (let effectIndex = 0; effectIndex < effectArray.length; effectIndex++) {
        await AutomatedEffect.process(tokenArray[actorIndex], effectArray[effectIndex]);
      }
    }
  }

  /**
   *
   * @param {object} tokenPF2e
   * @param {boolean} onTurnEnd
   */
  static async processAllEffects(tokenPF2e, onTurnEnd) {
    let effectArray = AutomatedEffect.retrieve(tokenPF2e, onTurnEnd);
    //AdvancedAutomation.log(effectArray);
    if (effectArray.length < 1) return;

    for (let effectIndex = 0; effectIndex < effectArray.length; effectIndex++) {
      await AutomatedEffect.process(tokenPF2e, effectArray[effectIndex]);
    }
  }
}

class AutomatedEffectWindow extends FormApplication {
  static get defaultOptions() {
    const defaults = super.defaultOptions;

    const overrides = {
      width: 450,
      height: 'auto',
      id: 'Automated-Effect-Window',
      template: AdvancedAutomation.TEMPLATES.EFFECTWINDOW,
      title: 'Apply Persistent Effect',
    };

    const mergedOptions = foundry.utils.mergeObject(defaults, overrides);

    return mergedOptions;
  }

  _collectData(html) {
    return {
      type: html.find('[name=type]:checked').val() || 'acid',
      dieFormula: html.find('[name="damage"]').val() || '1d6',
      difficultyClass: Number(html.find('[name="DC"]').val()) || 15,
      isHealing: html.find('[name=type]:checked').val() == 'Healing' ? true : false,
      isEndOfTurn: html.find('[name="endOfTurn"]')[0].checked || true,
      duration: Number(html.find('[name="duration"]').val()) || 0,
    };
  }

  _handleButtonClick(html) {
    if (canvas.tokens.controlled.length < 1) {
      ui.notifications.warn('you must sellect a token');
      return;
    }

    for (let index = 0; index < canvas.tokens.controlled.length; index++) {
      const target = canvas.tokens.controlled[index];
      AutomatedEffect.create(target.id, this._collectData(html));
    }
  }

  activateListeners(html) {
    super.activateListeners(html);

    const applyButton = html.find("button[name='apply']");
    applyButton.on('click', (event) => this._handleButtonClick(html));

    //html.on('click', "button[name='apply']", this._handleButtonClick(html));
  }

  getData() {
    function getTypeData(type) {
      return {
        damageType: type,
        name: type,
        img: AdvancedAutomation.TYPEIMAGES[type],
      };
    }
    const typeArray = Object.keys(AdvancedAutomation.TYPEIMAGES).map(getTypeData);
    AdvancedAutomation.log(typeArray);

    return { types: typeArray };
  }
}
Hooks.on('pf2e.endTurn', (combatantPF2e) => {
  //AdvancedAutomation.log(combatantPF2e);

  if (game.settings.get(AdvancedAutomation.ID, AdvancedAutomation.SETTINGS.BATCH_PROCESS_ACTORS)) {
    AutomatedEffect.massProcessAllEffects(combatantPF2e.actor.id, true);
    return;
  }

  AutomatedEffect.processAllEffects(canvas.tokens.get(combatantPF2e.data.tokenId), true);
});

Hooks.on('pf2e.startTurn', (combatantPF2e) => {
  //AdvancedAutomation.log(combatantPF2e);

  if (game.settings.get(AdvancedAutomation.ID, AdvancedAutomation.SETTINGS.BATCH_PROCESS_ACTORS)) {
    AutomatedEffect.massProcessAllEffects(combatantPF2e.actor.id, false);
    return;
  }

  AutomatedEffect.processAllEffects(canvas.tokens.get(combatantPF2e.data.tokenId), false);
});