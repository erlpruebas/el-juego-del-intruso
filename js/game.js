/**
 * Controlador Principal de Partida para "El Juego del Intruso".
 * Coordina:
 * - Mesa de juego con 1 Humano + 4 Monstruos IA (Buba, Kiko, Momo, Zorg) con Gemini 3.8 Flash
 * - Sistema de Rondas Eliminatorias: si la mesa vota a un Inocente, ese jugador queda eliminado
 *   y el Intruso se salva pasando a la siguiente ronda hasta que lo descubran o queden 2 jugadores.
 * - Botón «⚡ Resolver la Partida» cuando el jugador humano es eliminado para saltar directo al desenlace.
 * - Gran Celebración de Fin de Partida (Victoria, Derrota o Robo Épico) donde los 4 monstruos comentan
 *   simultáneamente la jugada en sus bocadillos con confeti, fanfarria y revelación de roles.
 */

class IntrusoGame {
  constructor() {
    this.players = [
      { id: "human", name: "Tú (Jugador)", isAI: false },
      ...window.MONSTER_PROFILES.map((m) => ({
        id: m.id,
        name: m.name,
        title: m.title,
        personality: m.personality,
        color: m.color,
        isAI: true,
      })),
    ];

    this.usedWords = new Set();
    this.score = {
      humanWins: 0,
      aiWins: 0,
      matchesPlayed: 0,
    };

    this.pacingMode = "cinematic"; // "cinematic" | "step" | "fast"
    this.isPaused = false;
    this._stepResolver = null;
    this._nextSurvivalRoundResolver = null;
    this._gameRunId = 0;

    this.state = {
      status: "idle",
      roundNum: 1,
      secretWord: null,
      secretCategory: null,
      intruderId: null,
      eliminatedIds: [],
      turnOrder: [],
      turnIndex: 0,
      publicClues: [],
      publicDebate: [],
      votes: {},
      caughtIntruder: false,
      mostVotedId: null,
    };

    this._humanClueResolver = null;
    this._humanDebateResolver = null;
    this._humanVoteResolver = null;
    this._humanLastChanceResolver = null;
  }

  async init() {
    window.monsterAnimator.preloadAll();
    window.monsterAnimator.bindDOM();
    window.monsterAnimator.startLoop();
    window.soundEngine?.preloadMonsterClips();

    await window.aiEngine.detectEnvironment();
    this._setupUIListeners();
    this._renderClueHistory();
    this._updateStatusBanner(
      "¡Bienvenido a la mesa de El Intruso! Pulsa «🎲 Jugar» arriba a la derecha para repartir cartas."
    );

    // Soporte de estados de prueba visual para verificación de diseño adaptable
    const params = new URLSearchParams(window.location.search);
    const testState = params.get("test_state");
    if (testState) {
      this._applyVisualTestState(testState);
    }
  }

  _getActivePlayers() {
    return this.players.filter((p) => !this.state.eliminatedIds.includes(p.id));
  }

  _getActiveMonsters() {
    return window.MONSTER_PROFILES.filter(
      (m) => !this.state.eliminatedIds.includes(m.id)
    );
  }

  _isHumanAlive() {
    return !this.state.eliminatedIds.includes("human");
  }

  _setupUIListeners() {
    // Iniciar música de fondo al primer clic del usuario en la página si está activada
    const unlockAudioOnce = () => {
      if (window.soundEngine?.musicEnabled && !window.soundEngine?._musicTimer) {
        window.soundEngine.startMusic();
      }
      window.removeEventListener("pointerdown", unlockAudioOnce);
    };
    window.addEventListener("pointerdown", unlockAudioOnce);

    document.getElementById("btn-new-game")?.addEventListener("click", () => {
      this.startNewGame();
    });

    document.getElementById("btn-play-again-summary")?.addEventListener("click", () => {
      this.startNewGame();
    });

    document.getElementById("select-pacing")?.addEventListener("change", (e) => {
      this.pacingMode = e.target.value;
      this.isPaused = false;
      this._updatePauseButtonUI();
      if (this._stepResolver && this.pacingMode !== "step") {
        const r = this._stepResolver;
        this._stepResolver = null;
        r();
      }
    });

    document.getElementById("btn-pause-toggle")?.addEventListener("click", () => {
      this.isPaused = !this.isPaused;
      this._updatePauseButtonUI();
      if (!this.isPaused && this._stepResolver) {
        const r = this._stepResolver;
        this._stepResolver = null;
        r();
      }
    });

    document.getElementById("btn-next-step")?.addEventListener("click", () => {
      this.isPaused = false;
      this._updatePauseButtonUI();
      if (this._stepResolver) {
        const r = this._stepResolver;
        this._stepResolver = null;
        r();
      }
    });

    // Botones "⚡ Resolver la Partida" cuando el jugador humano ha sido eliminado
    ["btn-resolve-match-now", "btn-resolve-bar", "btn-resolve-idle"].forEach((btnId) => {
      document.getElementById(btnId)?.addEventListener("click", () => {
        this.resolveMatchImmediately();
      });
    });

    window.addEventListener("keydown", (e) => {
      if (
        e.code === "Space" &&
        document.activeElement?.tagName !== "INPUT" &&
        this._stepResolver
      ) {
        e.preventDefault();
        const r = this._stepResolver;
        this._stepResolver = null;
        r();
      }
    });

    document.getElementById("select-scene")?.addEventListener("change", (e) => {
      const stage = document.getElementById("table-stage");
      if (stage) {
        stage.classList.remove(
          "scene-velvet-club",
          "scene-cyber-lab",
          "scene-tavern-wood",
          "scene-detective-bunker"
        );
        stage.classList.add(`scene-${e.target.value}`);
      }
    });

    document.getElementById("toggle-music")?.addEventListener("change", (e) => {
      window.soundEngine?.setMusicEnabled(e.target.checked);
      const lbl = document.getElementById("music-toggle-label");
      if (lbl) lbl.textContent = e.target.checked ? "🎵 Música" : "🔇 Sin Música";
    });

    document.getElementById("toggle-sound")?.addEventListener("change", (e) => {
      window.soundEngine?.setEnabled(e.target.checked);
      const lbl = document.getElementById("sound-toggle-label");
      if (lbl) lbl.textContent = e.target.checked ? "🔊 Voces" : "🔇 Silencio";
    });

    // Envío de pista del humano
    document.getElementById("human-clue-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this._handleHumanClueSubmit();
    });

    // Envío de comentario de debate del humano
    document.getElementById("human-debate-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this._handleHumanDebateSubmit(false);
    });
    document.getElementById("btn-skip-debate")?.addEventListener("click", () => {
      this._handleHumanDebateSubmit(true);
    });

    // Botón para avanzar a la siguiente ronda tras una eliminación de un inocente o empate
    document.getElementById("btn-next-survival-round")?.addEventListener("click", () => {
      if (this._nextSurvivalRoundResolver) {
        const r = this._nextSurvivalRoundResolver;
        this._nextSurvivalRoundResolver = null;
        r();
      }
    });

    // Última oportunidad del humano
    document.getElementById("human-last-chance-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("human-last-chance-input");
      const val = (input?.value || "").trim();
      if (!val) return;
      input.value = "";
      if (this._humanLastChanceResolver) {
        const r = this._humanLastChanceResolver;
        this._humanLastChanceResolver = null;
        r(val);
      }
    });

    // Clic en tarjetas de monstruos vivos para votar
    window.MONSTER_PROFILES.forEach((m) => {
      const card = document.getElementById(`monster-card-${m.id}`);
      card?.addEventListener("click", () => {
        if (
          this.state.status === "voting" &&
          this._humanVoteResolver &&
          !this.state.eliminatedIds.includes(m.id)
        ) {
          window.soundEngine?.playVoteStamp();
          const r = this._humanVoteResolver;
          this._humanVoteResolver = null;
          r(m.id);
        }
      });
    });
  }

  _updatePauseButtonUI() {
    const btnPause = document.getElementById("btn-pause-toggle");
    if (!btnPause) return;
    btnPause.textContent = this.isPaused ? "▶️ Reanudar" : "⏸️ Pausar";
  }

  _updateResolveButtonsVisibility() {
    const showResolve =
      !this._isHumanAlive() &&
      this.state.status !== "finished";

    ["btn-resolve-match-now", "btn-resolve-bar", "btn-resolve-idle"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle("hidden", !showResolve);
    });
  }

  _pickSecretWord() {
    const bank = window.INTRUSO_WORD_BANK || [{ word: "Guitarra", category: "Música" }];
    let available = bank.filter((item) => !this.usedWords.has(item.word));
    if (available.length === 0) {
      this.usedWords.clear();
      available = bank;
    }
    const chosen = available[Math.floor(Math.random() * available.length)];
    this.usedWords.add(chosen.word);
    return chosen;
  }

  _buildTurnOrder(intruderId) {
    const ids = this.players.map((p) => p.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    // El Intruso nunca sale #1 en la Ronda 1 porque va a ciegas
    if (ids[0] === intruderId) {
      const swapIdx = 1 + Math.floor(Math.random() * (ids.length - 1));
      [ids[0], ids[swapIdx]] = [ids[swapIdx], ids[0]];
    }
    return ids;
  }

  async startNewGame() {
    this._gameRunId++;
    const runId = this._gameRunId;
    this.isPaused = false;
    this._clearPendingResolvers();
    window.aiEngine.clearAuditLog();

    if (window.soundEngine?.musicEnabled && !window.soundEngine?._musicTimer) {
      window.soundEngine.startMusic();
    }
    window.soundEngine?.playCardDeal();

    const stage = document.getElementById("table-stage");
    stage?.classList.remove("finale-stage-win", "finale-stage-steal", "finale-stage-loss");
    this._clearConfetti();

    const chosen = this._pickSecretWord();
    const roleMode = document.getElementById("select-role-mode")?.value || "random";

    let intruderId = "buba";
    if (roleMode === "always_intruder") {
      intruderId = "human";
    } else if (roleMode === "always_innocent") {
      const aiIds = window.MONSTER_PROFILES.map((m) => m.id);
      intruderId = aiIds[Math.floor(Math.random() * aiIds.length)];
    } else {
      const allIds = this.players.map((p) => p.id);
      intruderId = allIds[Math.floor(Math.random() * allIds.length)];
    }

    const turnOrder = this._buildTurnOrder(intruderId);

    this.state = {
      status: "clues",
      roundNum: 1,
      secretWord: chosen.word,
      secretCategory: chosen.category,
      intruderId,
      eliminatedIds: [],
      turnOrder,
      turnIndex: 0,
      publicClues: [],
      publicDebate: [],
      votes: {},
      caughtIntruder: false,
      mostVotedId: null,
    };

    this._updateResolveButtonsVisibility();
    window.monsterAnimator.setAllEmotions("normal");
    this._clearAllSpeechBubbles();
    const humanChips = document.getElementById("human-chips-row");
    if (humanChips) humanChips.innerHTML = "";

    window.MONSTER_PROFILES.forEach((m) => {
      window.monsterAnimator.setTalking(m.id, false);
      this._clearMonsterChips(m.id);
      this._setMonsterVoteBadge(m.id, "");
      document.getElementById(`monster-card-${m.id}`)?.classList.remove(
        "active-turn",
        "votable-target",
        "revealed-intruder",
        "revealed-innocent",
        "eliminated-seat",
        "finale-commenting"
      );
    });

    this._renderSecretRoleCard();
    this._renderTurnBadgesOnSeats();
    this._renderClueHistory();
    this._showOnlyTablePanel("panel-table-idle");
    this._setIdlePanelText(
      "🃏 Cartas secretas repartidas (5 jugadores activos)",
      "Cada ronda se dice una pista, se debate y se vota. Si expulsáis a un Inocente, el Intruso sobrevive y pasa de ronda."
    );

    this._updateStatusBanner("🃏 Repartiendo cartas secretas en la mesa...");
    await this._sleep(1000);
    if (runId !== this._gameRunId) return;

    await this.runCluePhase(runId);
  }

  _renderSecretRoleCard() {
    const roleCard = document.getElementById("human-secret-card");
    const roleTitle = document.getElementById("secret-role-title");
    const roleWord = document.getElementById("secret-role-word");
    const roleHint = document.getElementById("secret-role-hint");
    if (!roleCard) return;

    const isHumanIntruder = this.state.intruderId === "human";
    roleCard.classList.remove("role-innocent", "role-intruder");

    if (isHumanIntruder) {
      roleCard.classList.add("role-intruder");
      roleTitle.textContent = "🎭 ROL: ¡INTRUSO!";
      roleWord.textContent =
        this.state.status === "finished"
          ? `ERA: «${this.state.secretWord.toUpperCase()}»`
          : "PALABRA: ??? (A CIEGAS)";
      roleHint.textContent =
        "Camúflate entre los monstruos para que voten a un inocente o adivina su palabra secreta.";
    } else {
      roleCard.classList.add("role-innocent");
      roleTitle.textContent = "🛡️ ROL: INOCENTE";
      roleWord.textContent = `PALABRA: «${this.state.secretWord.toUpperCase()}»`;
      roleHint.textContent =
        "Cazad al Intruso antes de que queden solo 2 jugadores. ¡No digas la palabra exacta!";
    }
  }

  _renderTurnBadgesOnSeats() {
    const activeTurnOrder = this.state.turnOrder.filter(
      (pid) => !this.state.eliminatedIds.includes(pid)
    );
    const totalActive = activeTurnOrder.length;

    window.MONSTER_PROFILES.forEach((m) => {
      const mb = document.getElementById(`turn-badge-${m.id}`);
      if (!mb) return;
      if (this.state.eliminatedIds.includes(m.id)) {
        mb.textContent = "❌ Eliminado";
        mb.classList.remove("hidden");
      } else {
        const pos = activeTurnOrder.indexOf(m.id) + 1;
        mb.textContent = `Turno #${pos}`;
        mb.classList.remove("hidden");
      }
    });

    const hb = document.getElementById("turn-badge-human");
    if (hb) {
      if (this.state.eliminatedIds.includes("human")) {
        hb.textContent = "❌ Eliminado";
      } else {
        const hPos = activeTurnOrder.indexOf("human") + 1;
        hb.textContent = `Turno #${hPos}/${totalActive}`;
      }
    }

    const bar = document.getElementById("turn-order-strip");
    if (bar) {
      bar.textContent = activeTurnOrder
        .map((pid, idx) => {
          const p = this.players.find((x) => x.id === pid);
          return `${idx + 1}.${p ? p.name.replace(" (Jugador)", "") : pid}`;
        })
        .join(" · ");
    }
  }

  async runCluePhase(runId) {
    this.state.status = "clues";
    this._updateResolveButtonsVisibility();

    const activeOrder = this.state.turnOrder.filter(
      (pid) => !this.state.eliminatedIds.includes(pid)
    );
    const totalTurns = activeOrder.length;
    this.state.turnIndex = 0;
    this._renderTurnBadgesOnSeats();

    while (this.state.turnIndex < totalTurns && this.state.status === "clues") {
      if (runId !== this._gameRunId) return;
      const currentId = activeOrder[this.state.turnIndex];
      const stepNum = this.state.turnIndex + 1;

      this._clearAllSpeechBubbles();
      this._highlightActiveSpeaker(currentId);

      if (currentId === "human") {
        this._setPacingControlsVisible(false);
        this._updateStatusBanner(
          `🎯 Ronda ${this.state.roundNum} (Turno ${stepNum}/${totalTurns}) · ¡Es tu turno! Escribe una palabra pista.`
        );
        this._showOnlyTablePanel("panel-human-clue");
        const word = await this._waitForHumanClue();
        if (runId !== this._gameRunId || this.state.status !== "clues") return;

        window.soundEngine?.playChipDrop();
        this._recordPublicClue({
          round: this.state.roundNum,
          speakerId: "human",
          speakerName: "Tú",
          word,
          reaction: "",
        });
        this._showOnlyTablePanel("panel-table-idle");
        this._setIdlePanelText(
          `✅ Has jugado la pista: «${word}»`,
          "Los monstruos supervivientes toman nota de tu pista..."
        );
        await this._sleep(900);
      } else {
        const monster = window.MONSTER_PROFILES.find((m) => m.id === currentId);
        this._showOnlyTablePanel("panel-table-idle");
        this._setIdlePanelText(
          `🎙️ Ronda ${this.state.roundNum} (Turno ${stepNum}/${totalTurns}): Habla ${monster.name}`,
          `${monster.name} está pensando una nueva palabra pista...`
        );
        this._updateStatusBanner(
          `💬 Ronda ${this.state.roundNum} (Turno ${stepNum}/${totalTurns}) · ${monster.name} piensa su pista...`
        );

        this._setMonsterBubble(monster.id, "🤔 <em>Pensando pista...</em>");
        window.soundEngine?.playThinkingHmm(monster.id);

        const role = this.state.intruderId === monster.id ? "intruso" : "inocente";
        const isolatedPayload = window.aiEngine.buildIsolatedContext({
          agentProfile: monster,
          agentRole: role,
          secretWord: this.state.secretWord,
          phase: "clue",
          roundNum: this.state.roundNum,
          publicClues: this.state.publicClues,
          publicDebate: this.state.publicDebate,
          validTargets: this._getActivePlayers().filter((p) => p.id !== monster.id),
        });

        const [res] = await Promise.all([
          window.aiEngine.runAgentTurn(isolatedPayload).catch((err) => ({
            _error: err.message,
          })),
          this._sleep(this.pacingMode === "fast" ? 400 : 1050),
        ]);
        if (runId !== this._gameRunId) return;

        if (res._error) {
          this._setMonsterBubble(monster.id, `⚠️ ${this._escapeHtml(res._error)}`);
        } else {
          const spokenWord = this._sanitizeClueWord(res.word || "Misterio");
          const emotion = res.emotion || "normal";
          const reaction = this._redactSecretLeak(res.short_reaction || "");

          window.monsterAnimator.setEmotion(monster.id, emotion);
          window.monsterAnimator.setTalking(monster.id, true);

          this._setMonsterBubble(
            monster.id,
            `🃏 Pista R${this.state.roundNum}: «<strong>${this._escapeHtml(
              spokenWord
            )}</strong>»${reaction ? `<br><small>${this._escapeHtml(reaction)}</small>` : ""}`
          );
          this._setIdlePanelText(
            `🃏 ${monster.name} juega la pista: «${spokenWord}»`,
            reaction || "Observa cómo reaccionan los demás en la mesa."
          );
          this._updateStatusBanner(
            `🗣️ Ronda ${this.state.roundNum} · <strong>${monster.name}</strong> dice la pista: «<strong>${this._escapeHtml(
              spokenWord
            )}</strong>»`
          );

          window.soundEngine?.playChipDrop();
          this._recordPublicClue({
            round: this.state.roundNum,
            speakerId: monster.id,
            speakerName: monster.name,
            word: spokenWord,
            reaction,
          });

          await window.soundEngine?.playMonsterVoice(
            monster.id,
            emotion,
            `${spokenWord} ${reaction}`
          );
          if (runId !== this._gameRunId) return;
          window.monsterAnimator.setTalking(monster.id, false);

          this._triggerListenerMicroReaction(monster.id);

          await this._waitTurnPacing(this.pacingMode === "fast" ? 800 : 2200);
          if (runId !== this._gameRunId) return;
        }
      }

      this.state.turnIndex++;
    }

    this._setPacingControlsVisible(false);
    this._highlightActiveSpeaker(null);
    this._clearAllSpeechBubbles();

    await this.runDebatePhase(runId);
  }

  _triggerListenerMicroReaction(speakerId) {
    const others = this._getActiveMonsters().filter((m) => m.id !== speakerId);
    const randomOther = others[Math.floor(Math.random() * others.length)];
    if (!randomOther) return;
    const roll = Math.random();
    if (roll < 0.35) {
      window.monsterAnimator.setEmotion(randomOther.id, "enfadado");
    } else if (roll < 0.6) {
      window.monsterAnimator.setEmotion(randomOther.id, "sorprendido");
    }
  }

  async runDebatePhase(runId) {
    this.state.status = "debate";
    this._updateResolveButtonsVisibility();
    this._showOnlyTablePanel("panel-table-idle");
    const activeMonsters = this._getActiveMonsters();

    this._updateStatusBanner(
      `🔥 Debate de la Ronda ${this.state.roundNum}: Los ${activeMonsters.length} monstruos en juego lanzan sus sospechas...`
    );

    for (let i = 0; i < activeMonsters.length; i++) {
      if (runId !== this._gameRunId || this.state.status !== "debate") return;
      const monster = activeMonsters[i];

      this._clearAllSpeechBubbles();
      this._highlightActiveSpeaker(monster.id);
      this._setMonsterBubble(monster.id, "🤨 <em>Evaluando quién miente...</em>");
      this._setIdlePanelText(
        `🔍 Debate Ronda ${this.state.roundNum} (${i + 1}/${activeMonsters.length}): Habla ${monster.name}`,
        `${monster.name} analiza las pistas de la mesa...`
      );
      window.soundEngine?.playThinkingHmm(monster.id);

      const role = this.state.intruderId === monster.id ? "intruso" : "inocente";
      const validTargets = this._getActivePlayers().filter((p) => p.id !== monster.id);
      const isolatedPayload = window.aiEngine.buildIsolatedContext({
        agentProfile: monster,
        agentRole: role,
        secretWord: this.state.secretWord,
        phase: "debate",
        roundNum: this.state.roundNum,
        publicClues: this.state.publicClues,
        publicDebate: this.state.publicDebate,
        validTargets,
      });

      const [res] = await Promise.all([
        window.aiEngine.runAgentTurn(isolatedPayload).catch((err) => ({
          _error: err.message,
        })),
        this._sleep(this.pacingMode === "fast" ? 400 : 1000),
      ]);
      if (runId !== this._gameRunId) return;

      if (!res._error) {
        const rawComment = res.comment || "Alguien aquí ha dicho una pista muy rara...";
        const safeComment = this._redactSecretLeak(rawComment);
        const emotion = res.emotion || "enfadado";

        window.monsterAnimator.setEmotion(monster.id, emotion);
        window.monsterAnimator.setTalking(monster.id, true);
        window.soundEngine?.playEmotionReaction(emotion);

        this._setMonsterBubble(monster.id, `💬 «${this._escapeHtml(safeComment)}»`);
        this._setIdlePanelText(`💬 ${monster.name} acusa:`, `«${safeComment}»`);
        this._updateStatusBanner(
          `🗣️ Debate R${this.state.roundNum} (${i + 1}/${activeMonsters.length}) · <strong>${
            monster.name
          }</strong>: «${this._escapeHtml(safeComment)}»`
        );

        this.state.publicDebate.push({
          speakerId: monster.id,
          speakerName: monster.name,
          comment: safeComment,
          suspectId: res.suspect_id || null,
        });
        this._renderClueHistory();

        await window.soundEngine?.playMonsterVoice(monster.id, emotion, safeComment);
        if (runId !== this._gameRunId) return;
        window.monsterAnimator.setTalking(monster.id, false);

        await this._waitTurnPacing(this.pacingMode === "fast" ? 900 : 2500);
      }
    }

    this._setPacingControlsVisible(false);
    this._clearAllSpeechBubbles();

    if (this._isHumanAlive()) {
      this._highlightActiveSpeaker("human");
      this._updateStatusBanner(
        `🗣️ Tu turno en el Debate (Ronda ${this.state.roundNum}): escribe una acusación o pasa directo a votar.`
      );
      this._showOnlyTablePanel("panel-human-debate");
      await this._waitForHumanDebate();
      if (runId !== this._gameRunId || this.state.status !== "debate") return;
    }

    await this.runVotingPhase(runId);
  }

  async runVotingPhase(runId) {
    this.state.status = "voting";
    this._updateResolveButtonsVisibility();
    this.state.votes = {};
    this._highlightActiveSpeaker(null);
    this._clearAllSpeechBubbles();

    const activeMonsters = this._getActiveMonsters();
    activeMonsters.forEach((m) => {
      this._setMonsterVoteBadge(m.id, "");
    });

    if (this._isHumanAlive()) {
      this._showOnlyTablePanel("panel-voting-prompt");
      activeMonsters.forEach((m) => {
        document.getElementById(`monster-card-${m.id}`)?.classList.add("votable-target");
      });
      this._updateStatusBanner(
        `🗳️ Votación de la Ronda ${this.state.roundNum}: Haz clic sobre uno de los ${activeMonsters.length} monstruos activos para votar.`
      );

      const humanTargetId = await new Promise((resolve) => {
        this._humanVoteResolver = resolve;
      });
      if (runId !== this._gameRunId || this.state.status !== "voting") return;

      this.state.votes["human"] = {
        targetId: humanTargetId,
        reason: "Acusación directa del jugador.",
      };

      activeMonsters.forEach((m) => {
        document.getElementById(`monster-card-${m.id}`)?.classList.remove("votable-target");
      });
      this._showOnlyTablePanel("panel-table-idle");

      const humanTarget = this.players.find((p) => p.id === humanTargetId);
      this._setIdlePanelText(
        `🗳️ Has votado a ${humanTarget?.name}`,
        "Ahora los monstruos supervivientes revelan sus votos..."
      );
    } else {
      this._showOnlyTablePanel("panel-table-idle");
      this._setIdlePanelText(
        `🗳️ Votación de la Ronda ${this.state.roundNum}`,
        "Los monstruos supervivientes están votando (o pulsa «⚡ Resolver la Partida»)."
      );
    }

    for (const monster of activeMonsters) {
      if (runId !== this._gameRunId) return;
      this._highlightActiveSpeaker(monster.id);
      this._updateStatusBanner(`🗳️ ${monster.name} está decidiendo su voto...`);

      const role = this.state.intruderId === monster.id ? "intruso" : "inocente";
      const validTargets = this._getActivePlayers().filter((p) => p.id !== monster.id);
      const isolatedPayload = window.aiEngine.buildIsolatedContext({
        agentProfile: monster,
        agentRole: role,
        secretWord: this.state.secretWord,
        phase: "vote",
        roundNum: this.state.roundNum,
        publicClues: this.state.publicClues,
        publicDebate: this.state.publicDebate,
        validTargets,
      });

      try {
        const res = await window.aiEngine.runAgentTurn(isolatedPayload);
        if (runId !== this._gameRunId) return;

        let targetId = (res.vote_id || "").toLowerCase().trim();
        if (!validTargets.some((t) => t.id === targetId)) {
          const byName = validTargets.find((t) =>
            t.name.toLowerCase().includes(targetId)
          );
          targetId = byName ? byName.id : validTargets[0].id;
        }
        const reason = this._redactSecretLeak(res.reason || "Su pista no me cuadró nada.");
        this.state.votes[monster.id] = { targetId, reason };
        window.monsterAnimator.setEmotion(monster.id, res.emotion || "enfadado");

        const targetPlayer = this.players.find((p) => p.id === targetId);
        window.soundEngine?.playVoteStamp();
        this._setMonsterVoteBadge(
          monster.id,
          `🗳️ Vota: ${targetPlayer ? targetPlayer.name.replace(" (Jugador)", "") : targetId}`
        );
        this._clearAllSpeechBubbles();
        this._setMonsterBubble(
          monster.id,
          `🗳️ Voto a <strong>${targetPlayer?.name.replace(" (Jugador)", "")}</strong>:<br><small>${this._escapeHtml(
            reason
          )}</small>`
        );
        window.monsterAnimator.setTalking(monster.id, true);
        await window.soundEngine?.playMonsterVoice(monster.id, "enfadado", reason);
        window.monsterAnimator.setTalking(monster.id, false);
        await this._sleep(this.pacingMode === "fast" ? 500 : 1250);
      } catch (_) {
        const fallbackTarget = validTargets[0].id;
        this.state.votes[monster.id] = {
          targetId: fallbackTarget,
          reason: "Sospecha intuitiva.",
        };
      }
    }

    this._highlightActiveSpeaker(null);
    this._clearAllSpeechBubbles();
    await this.resolveVotes(runId);
  }

  async resolveVotes(runId) {
    const activePlayers = this._getActivePlayers();
    const tally = {};
    activePlayers.forEach((p) => (tally[p.id] = 0));

    Object.values(this.state.votes).forEach((v) => {
      if (tally[v.targetId] !== undefined) {
        tally[v.targetId]++;
      }
    });

    let maxVotes = -1;
    let tiedIds = [];
    for (const [pid, count] of Object.entries(tally)) {
      if (count > maxVotes) {
        maxVotes = count;
        tiedIds = [pid];
      } else if (count === maxVotes) {
        tiedIds.push(pid);
      }
    }

    // CASO 1: Empate en el primer puesto -> Nadie es eliminado y se pasa a la siguiente ronda
    if (tiedIds.length > 1) {
      window.soundEngine?.playEmotionReaction("sorprendido");
      const tiedNames = tiedIds
        .map((id) => this.players.find((p) => p.id === id)?.name.replace(" (Jugador)", ""))
        .join(" y ");

      this._updateStatusBanner(
        `⚖️ ¡EMPATE EN LA VOTACIÓN (${tiedNames} con ${maxVotes} votos)! Nadie es eliminado y el Intruso sigue oculto.`
      );
      await this._showRoundEliminationModal({
        title: `⚖️ ¡Empate en la Ronda ${this.state.roundNum}! Nadie es expulsado`,
        body: `Empate a <strong>${maxVotes} votos</strong> entre <strong>${tiedNames}</strong>. Nadie abandona la mesa y el <strong>Intruso</strong> gana tiempo pasando a la <strong>Ronda ${
          this.state.roundNum + 1
        }</strong>.`,
      });
      if (runId !== this._gameRunId) return;

      this.state.roundNum++;
      await this.runCluePhase(runId);
      return;
    }

    const mostVotedId = tiedIds[0];
    this.state.mostVotedId = mostVotedId;
    const caughtIntruder = mostVotedId === this.state.intruderId;
    this.state.caughtIntruder = caughtIntruder;

    // CASO 2: Se ha votado a un INOCENTE -> Queda eliminado
    if (!caughtIntruder) {
      this.state.eliminatedIds.push(mostVotedId);
      this._updateResolveButtonsVisibility();
      const eliminatedPlayer = this.players.find((p) => p.id === mostVotedId);

      if (mostVotedId !== "human") {
        window.monsterAnimator.setEmotion(mostVotedId, "sorprendido");
        const card = document.getElementById(`monster-card-${mostVotedId}`);
        card?.classList.add("eliminated-seat", "revealed-innocent");
        this._setMonsterVoteBadge(mostVotedId, "❌ Expulsado (Inocente)");
      }

      this._renderTurnBadgesOnSeats();
      const survivors = this._getActivePlayers();

      // Si solo quedan 2 jugadores en la mesa (1 Intruso + 1 Inocente), ¡el Intruso gana por supervivencia!
      if (survivors.length <= 2) {
        this._finishMatch({
          intruderCaught: false,
          intruderGuessedWord: false,
          guessedWordText: null,
          eliminatedLastName: eliminatedPlayer?.name.replace(" (Jugador)", ""),
        });
        return;
      }

      // Quedan 3 o 4 supervivientes -> ¡El Intruso se libra en esta ronda!
      window.soundEngine?.playEmotionReaction("sorprendido");
      const survivorNames = survivors
        .map((s) => s.name.replace(" (Jugador)", ""))
        .join(", ");

      const humanJustEliminated = mostVotedId === "human";
      this._updateStatusBanner(
        humanJustEliminated
          ? `😱 ¡Te han expulsado con ${maxVotes} votos siendo INOCENTE! Pulsa «⚡ Resolver la Partida» para ver el desenlace final.`
          : `😱 ¡${eliminatedPlayer?.name} ha sido expulsado (${maxVotes} votos) y era INOCENTE! ¡El Intruso pasa a la Ronda ${
              this.state.roundNum + 1
            }!`
      );

      await this._showRoundEliminationModal({
        title: humanJustEliminated
          ? `😱 ¡Te han expulsado siendo INOCENTE!`
          : `😱 ¡Expulsasteis a ${eliminatedPlayer?.name} (Inocente)!`,
        body: humanJustEliminated
          ? `Los monstruos te han votado por error y el <strong>Intruso sigue oculto</strong> entre los ${survivors.length} supervivientes (<em>${survivorNames}</em>). Pulsa <strong>«⚡ Resolver la Partida»</strong> para descubrir quién gana o sigue observando.`
          : `🎭 <strong>¡El Intruso se ha librado en la Ronda ${this.state.roundNum}!</strong> Quedan <strong>${survivors.length} supervivientes</strong> (<em>${survivorNames}</em>). ¡Vamos a la <strong>Ronda ${
              this.state.roundNum + 1
            }</strong>!`,
      });
      if (runId !== this._gameRunId) return;

      this.state.roundNum++;
      await this.runCluePhase(runId);
      return;
    }

    // CASO 3: ¡El más votado SÍ ES EL INTRUSO! -> Última Oportunidad del Intruso
    this.state.status = "last_chance";

    if (this.state.intruderId === "human") {
      window.monsterAnimator.setAllEmotions("enfadado");
      window.soundEngine?.playEmotionReaction("sorprendido");
      this._updateStatusBanner(
        "😱 ¡Te han descubierto en la votación! Pero tienes una ÚLTIMA OPORTUNIDAD: ¡adivina la palabra secreta y roba la partida!"
      );
      this._showOnlyTablePanel("panel-human-last-chance");
      document.getElementById("human-last-chance-input")?.focus();

      const humanGuess = await new Promise((resolve) => {
        this._humanLastChanceResolver = resolve;
      });
      if (runId !== this._gameRunId) return;

      const success = this._compareWords(humanGuess, this.state.secretWord);
      this._finishMatch({
        intruderCaught: true,
        intruderGuessedWord: success,
        guessedWordText: humanGuess,
      });
    } else {
      const intruderMonster = window.MONSTER_PROFILES.find(
        (m) => m.id === this.state.intruderId
      );
      window.monsterAnimator.setAllEmotions("enfadado");
      window.monsterAnimator.setEmotion(intruderMonster.id, "sorprendido");
      this._highlightActiveSpeaker(intruderMonster.id);

      this._updateStatusBanner(
        `🎯 ¡Habéis cazado a ${intruderMonster.name} como el Intruso! Ahora tiene su Última Oportunidad para adivinar la palabra...`
      );
      this._setMonsterBubble(
        intruderMonster.id,
        "😱 ¡Me habéis pillado! Dejadme adivinar vuestra palabra secreta..."
      );
      window.monsterAnimator.setTalking(intruderMonster.id, true);
      await window.soundEngine?.playMonsterVoice(
        intruderMonster.id,
        "sorprendido",
        "Me habéis pillado"
      );
      window.monsterAnimator.setTalking(intruderMonster.id, false);

      let guessedWord = "";
      let comment = "";
      try {
        const isolatedPayload = window.aiEngine.buildIsolatedContext({
          agentProfile: intruderMonster,
          agentRole: "intruso",
          secretWord: null,
          phase: "last_chance",
          roundNum: this.state.roundNum,
          publicClues: this.state.publicClues,
          publicDebate: this.state.publicDebate,
          validTargets: [],
        });
        const res = await window.aiEngine.runAgentTurn(isolatedPayload);
        guessedWord = (res.guessed_word || "").trim();
        comment = res.comment || `¡Me la juego por ${guessedWord}!`;
      } catch (_) {
        guessedWord = "Misterio";
        comment = "¡No consigo deducir vuestra palabra!";
      }

      const success = this._compareWords(guessedWord, this.state.secretWord);
      this._setMonsterBubble(
        intruderMonster.id,
        `🎭 «${this._escapeHtml(comment)}»<br>Apuesta final: <strong>${this._escapeHtml(
          guessedWord
        )}</strong>`
      );
      window.monsterAnimator.setTalking(intruderMonster.id, true);
      await window.soundEngine?.playMonsterVoice(
        intruderMonster.id,
        success ? "normal" : "sorprendido",
        guessedWord
      );
      window.monsterAnimator.setTalking(intruderMonster.id, false);

      await this._sleep(1600);
      if (runId !== this._gameRunId) return;

      this._finishMatch({
        intruderCaught: true,
        intruderGuessedWord: success,
        guessedWordText: guessedWord,
      });
    }
  }

  /**
   * Resuelve inmediatamente el resto de la partida cuando el jugador humano ha sido eliminado
   * y pulsa «⚡ Resolver la Partida».
   */
  resolveMatchImmediately() {
    this._gameRunId++;
    this.isPaused = false;
    this._clearPendingResolvers();

    window.MONSTER_PROFILES.forEach((m) => {
      window.monsterAnimator.setTalking(m.id, false);
    });

    const intruderId = this.state.intruderId;
    const activeMonsters = this._getActiveMonsters();
    const innocentsAlive = activeMonsters.filter((m) => m.id !== intruderId);

    // Simulamos el desenlace rápido entre los monstruos supervivientes
    this.state.roundNum = Math.max(this.state.roundNum, 2);
    const intruderCaughtByMonsters = Math.random() < 0.55;

    this.state.votes = {};
    if (intruderCaughtByMonsters) {
      activeMonsters.forEach((m) => {
        if (m.id === intruderId) {
          const target = innocentsAlive[0] || activeMonsters[0];
          this.state.votes[m.id] = {
            targetId: target.id,
            reason: "¡Intenté desviar las sospechas hasta el final!",
          };
        } else {
          this.state.votes[m.id] = {
            targetId: intruderId,
            reason: "¡Sus pistas le delataron en la ronda decisiva!",
          };
        }
      });

      const intruderStoleWord = Math.random() < 0.35;
      const fallbackGuesses = ["Relámpago", " Espejo", "Laberinto", "Fuego", " Océano"];
      const wrongGuess =
        fallbackGuesses[Math.floor(Math.random() * fallbackGuesses.length)].trim();

      this._finishMatch({
        intruderCaught: true,
        intruderGuessedWord: intruderStoleWord,
        guessedWordText: intruderStoleWord ? this.state.secretWord : wrongGuess,
      });
    } else {
      const victim = innocentsAlive[0] || activeMonsters[0];
      if (victim && !this.state.eliminatedIds.includes(victim.id)) {
        this.state.eliminatedIds.push(victim.id);
      }
      activeMonsters.forEach((m) => {
        const targetId = m.id === victim?.id ? intruderId : victim?.id || intruderId;
        this.state.votes[m.id] = {
          targetId,
          reason:
            m.id === intruderId
              ? "¡Les convencí para votar a otro inocente!"
              : "Caí en la trampa del Intruso.",
        };
      });

      this._finishMatch({
        intruderCaught: false,
        intruderGuessedWord: false,
        guessedWordText: null,
        eliminatedLastName: victim?.name || "los inocentes",
      });
    }
  }

  async _showRoundEliminationModal({ title, body }) {
    const tEl = document.getElementById("elimination-title");
    const bEl = document.getElementById("elimination-body");
    if (tEl) tEl.innerHTML = title;
    if (bEl) bEl.innerHTML = body;
    this._updateResolveButtonsVisibility();
    this._showOnlyTablePanel("panel-round-elimination");

    await new Promise((resolve) => {
      this._nextSurvivalRoundResolver = resolve;
    });
  }

  _finishMatch({ intruderCaught, intruderGuessedWord, guessedWordText, eliminatedLastName }) {
    this.state.status = "finished";
    this._setPacingControlsVisible(false);
    this._updateResolveButtonsVisibility();
    this._highlightActiveSpeaker(null);
    this.score.matchesPlayed++;

    const intruderPlayer = this.players.find((p) => p.id === this.state.intruderId);
    const intruderName = intruderPlayer
      ? intruderPlayer.name.replace(" (Jugador)", "")
      : "Intruso";
    const isHumanIntruder = this.state.intruderId === "human";

    const intruderWins = !intruderCaught || intruderGuessedWord;
    const humanWon =
      (isHumanIntruder && intruderWins) || (!isHumanIntruder && !intruderWins);
    const isSteal = intruderCaught && intruderGuessedWord;

    if (humanWon) {
      this.score.humanWins++;
    } else {
      this.score.aiWins++;
    }
    this._updateScoreboard();
    this._renderSecretRoleCard();
    window.soundEngine?.playMatchEnd(humanWon);

    // 1. Efectos visuales de celebración en el escenario y confeti
    const stage = document.getElementById("table-stage");
    stage?.classList.remove("finale-stage-win", "finale-stage-steal", "finale-stage-loss");
    if (isSteal) {
      stage?.classList.add("finale-stage-steal");
      this._spawnConfetti(["#fbbf24", "#f472b6", "#a855f7", "#38bdf8"]);
    } else if (humanWon) {
      stage?.classList.add("finale-stage-win");
      this._spawnConfetti(["#10b981", "#fbbf24", "#34d399", "#60a5fa"]);
    } else {
      stage?.classList.add("finale-stage-loss");
      this._spawnConfetti(["#ef4444", "#f97316", "#f43f5e"]);
    }

    // 2. Construir titular, píldora de resultado y detalles
    let outcomePillText = "";
    let outcomePillClass = "";
    let summaryCardClass = "";
    let headline = "";
    let detail = "";

    if (isHumanIntruder && isSteal) {
      outcomePillText = "⚡ ¡ROBO ÉPICO!";
      outcomePillClass = "pill-outcome-steal";
      summaryCardClass = "finale-steal";
      headline = "¡Adivinaste la palabra secreta!";
      detail = `Los monstruos te descubrieron en la Ronda ${this.state.roundNum}, ¡pero acertaste que su palabra secreta era <strong>«${this.state.secretWord}»</strong> y te llevas una victoria legendaria!`;
    } else if (isHumanIntruder && !intruderCaught) {
      outcomePillText = "🏆 ¡VICTORIA!";
      outcomePillClass = "pill-outcome-win";
      summaryCardClass = "finale-win";
      headline = "¡Engañaste a toda la mesa!";
      detail = `Sobreviviste ${this.state.roundNum} rondas haciendo que expulsaran a los inocentes sin saber que la palabra era <strong>«${this.state.secretWord}»</strong>.`;
    } else if (!isHumanIntruder && !intruderWins) {
      outcomePillText = "🏆 ¡HAS GANADO!";
      outcomePillClass = "pill-outcome-win";
      summaryCardClass = "finale-win";
      headline = `¡Habéis cazado a ${intruderName}!`;
      detail = `Descubristeis que <strong>${intruderName}</strong> era el Intruso y falló su Última Oportunidad (apostó por <em>«${this._escapeHtml(
        guessedWordText || "nada"
      )}»</em> en lugar de <strong>«${this.state.secretWord}»</strong>).`;
    } else if (!isHumanIntruder && isSteal) {
      outcomePillText = `⚡ ¡ROBO DE ${intruderName.toUpperCase()}!`;
      outcomePillClass = "pill-outcome-steal";
      summaryCardClass = "finale-steal";
      headline = `¡${intruderName} os robó la partida!`;
      detail = `Habíais cazado a <strong>${intruderName}</strong> en la votación, ¡pero dedujo vuestras pistas y adivinó la palabra secreta <strong>«${this.state.secretWord}»</strong>!`;
    } else if (!isHumanIntruder && !intruderCaught) {
      outcomePillText = "💀 ¡DERROTA!";
      outcomePillClass = "pill-outcome-loss";
      summaryCardClass = "finale-loss";
      headline = `¡${intruderName} engañó a la mesa!`;
      detail = `Tras expulsar a <strong>${
        eliminatedLastName || "los inocentes"
      }</strong>, el Intruso <strong>${intruderName}</strong> sobrevivió hasta el final sin conocer la palabra <strong>«${
        this.state.secretWord
      }»</strong>.`;
    } else {
      outcomePillText = "🕵️ ¡CAZADO!";
      outcomePillClass = "pill-outcome-loss";
      summaryCardClass = "finale-loss";
      headline = "¡Te descubrieron como Intruso!";
      detail = `Te votaron en la Ronda ${this.state.roundNum} y tu apuesta final (<em>«${this._escapeHtml(
        guessedWordText || "ninguna"
      )}»</em>) no era la palabra secreta <strong>«${this.state.secretWord}»</strong>.`;
    }

    this._updateStatusBanner(`${outcomePillText} · ${headline}`);
    this._showOnlyTablePanel("panel-match-summary");

    const summaryCard = document.getElementById("panel-match-summary");
    if (summaryCard) {
      summaryCard.classList.remove("finale-win", "finale-steal", "finale-loss");
      summaryCard.classList.add(summaryCardClass);
    }

    const pillEl = document.getElementById("finale-outcome-pill");
    if (pillEl) {
      pillEl.textContent = outcomePillText;
      pillEl.className = `finale-outcome-pill ${outcomePillClass}`;
    }

    const revealStrip = document.getElementById("finale-reveal-strip");
    if (revealStrip) {
      revealStrip.innerHTML = `
        <span class="reveal-badge">🔑 «${this._escapeHtml(
          this.state.secretWord
        )}»</span>
        <span class="reveal-badge">🎭 Intruso: ${this._escapeHtml(intruderName)}</span>
      `;
    }

    const summaryTitle = document.getElementById("summary-title");
    const summaryBody = document.getElementById("summary-body");
    const summaryVotes = document.getElementById("summary-votes");

    if (summaryTitle && summaryBody && summaryVotes) {
      summaryTitle.innerHTML = headline;
      summaryBody.innerHTML = detail;

      const voteLines = Object.entries(this.state.votes).map(([voterId, v]) => {
        const voter = this.players.find((p) => p.id === voterId);
        const target = this.players.find((p) => p.id === v.targetId);
        const voterShort = voter?.name.replace(" (Jugador)", "") || voterId;
        const targetShort = target?.name.replace(" (Jugador)", "") || v.targetId;
        return `<li title="${this._escapeHtml(v.reason)}">🗳️ <strong>${this._escapeHtml(
          voterShort
        )}</strong> → <strong>${this._escapeHtml(targetShort)}</strong></li>`;
      });
      summaryVotes.innerHTML = voteLines.join("");
    }

    // 3. ¡TODOS LOS MONSTRUOS COMENTAN Y REACCIONAN AL FINAL DE LA PARTIDA!
    this._triggerAllMonstersFinaleComments({
      isHumanIntruder,
      intruderId: this.state.intruderId,
      intruderName,
      intruderCaught,
      intruderGuessedWord,
      secretWord: this.state.secretWord,
      guessedWordText: guessedWordText || "otra palabra",
    });
  }

  /**
   * Hace que los 4 monstruos de la mesa comenten a la vez el desenlace final
   * (ya sea victoria del jugador, derrota o robo épico) mostrando sus bocadillos
   * y emociones correspondientes.
   */
  _triggerAllMonstersFinaleComments({
    isHumanIntruder,
    intruderId,
    intruderName,
    intruderCaught,
    intruderGuessedWord,
    secretWord,
    guessedWordText,
  }) {
    const reactionsByMonster = {};

    if (isHumanIntruder && intruderCaught && intruderGuessedWord) {
      // El jugador humano era Intruso, lo pillaron, ¡pero ROBÓ la partida adivinando la palabra!
      reactionsByMonster.buba = {
        emotion: "sorprendido",
        text: `😱 ¡No puede ser! ¡Te habíamos pillado y nos has robado «${secretWord}»!`,
      };
      reactionsByMonster.kiko = {
        emotion: "enfadado",
        text: `🤯 ¡Qué robo tan épico! ¿Quién dio la pista que regaló «${secretWord}»?`,
      };
      reactionsByMonster.momo = {
        emotion: "sorprendido",
        text: `⚡ ¡Increíble! ¡Has deducido «${secretWord}» en el último segundo!`,
      };
      reactionsByMonster.zorg = {
        emotion: "normal",
        text: `👏 ¡Me quito el sombrero, humano! ¡Menudo atraco nos has hecho!`,
      };
    } else if (isHumanIntruder && !intruderCaught) {
      // El jugador humano era Intruso y ganó sobreviviendo sin ser cazado
      reactionsByMonster.buba = {
        emotion: "sorprendido",
        text: `😱 ¡¿El humano era el Intruso y no sabía que era «${secretWord}»?!`,
      };
      reactionsByMonster.kiko = {
        emotion: "enfadado",
        text: `🤡 ¡Nos hemos expulsado entre nosotros y el Intruso eras tú!`,
      };
      reactionsByMonster.momo = {
        emotion: "sorprendido",
        text: `🎭 ¡Jugada maestra! ¡Te has camuflado sin conocer «${secretWord}»!`,
      };
      reactionsByMonster.zorg = {
        emotion: "enfadado",
        text: `😤 ¡Nos has engañado a todos en la mesa, qué gran farol!`,
      };
    } else if (isHumanIntruder && intruderCaught && !intruderGuessedWord) {
      // El jugador humano era Intruso y perdió (fue cazado y falló la palabra)
      reactionsByMonster.buba = {
        emotion: "normal",
        text: `🕵️ ¡Te pillamos, humano! ¡La palabra secreta era «${secretWord}»!`,
      };
      reactionsByMonster.kiko = {
        emotion: "normal",
        text: `😂 ¡Apostaste por «${guessedWordText}», pero era «${secretWord}»!`,
      };
      reactionsByMonster.momo = {
        emotion: "normal",
        text: `🎉 ¡Victoria para los monstruos! ¡Tus pistas te delataron!`,
      };
      reactionsByMonster.zorg = {
        emotion: "normal",
        text: `😎 ¡Buen intento de farol, pero nadie engaña a esta mesa!`,
      };
    } else if (!isHumanIntruder && intruderCaught && !intruderGuessedWord) {
      // Un monstruo era el Intruso y el humano + inocentes GANARON cazándole
      const innocentWinLines = [
        `🏆 ¡Bien jugado! ¡Sabía que ${intruderName} mentía con «${secretWord}»!`,
        `🎉 ¡Victoria inocente! ¡Formamos un equipo de detectives brutal!`,
        `😎 ¡Imposible engañarnos con «${secretWord}», grande equipo!`,
      ];
      let lineIdx = 0;
      window.MONSTER_PROFILES.forEach((m) => {
        if (m.id === intruderId) {
          reactionsByMonster[m.id] = {
            emotion: "sorprendido",
            text: `😭 ¡Maldición! ¡Aposté por «${guessedWordText}» y era «${secretWord}»!`,
          };
        } else {
          reactionsByMonster[m.id] = {
            emotion: "normal",
            text: innocentWinLines[lineIdx++ % innocentWinLines.length],
          };
        }
      });
    } else if (!isHumanIntruder && intruderCaught && intruderGuessedWord) {
      // Un monstruo era el Intruso, lo cazaron, ¡pero ROBÓ la partida adivinando la palabra!
      const stealShockLines = [
        `😱 ¡Nooo! ¡Lo teníamos cazado y ${intruderName} adivinó «${secretWord}»!`,
        `😤 ¡Qué rabia! ¡Nuestras pistas de «${secretWord}» fueron muy claras!`,
        `🤯 ¡Menudo robo nos acaba de hacer ${intruderName} en la cara!`,
      ];
      let lineIdx = 0;
      window.MONSTER_PROFILES.forEach((m) => {
        if (m.id === intruderId) {
          reactionsByMonster[m.id] = {
            emotion: "normal",
            text: `⚡ ¡JAJAJA! ¡Me pillasteis, pero os robé «${secretWord}» al final!`,
          };
        } else {
          reactionsByMonster[m.id] = {
            emotion: "sorprendido",
            text: stealShockLines[lineIdx++ % stealShockLines.length],
          };
        }
      });
    } else {
      // Un monstruo era el Intruso y ganó por supervivencia engañando a la mesa
      const fooledLines = [
        `😱 ¡¿Era ${intruderName}?! ¡Y nosotros expulsando a inocentes!`,
        `🤦 ¡${intruderName} nos ha engañado sin saber que era «${secretWord}»!`,
        `😤 ¡Qué bien ha fingido ${intruderName} durante toda la partida!`,
      ];
      let lineIdx = 0;
      window.MONSTER_PROFILES.forEach((m) => {
        if (m.id === intruderId) {
          reactionsByMonster[m.id] = {
            emotion: "normal",
            text: `🎭 ¡Victoria total! ¡Os engañé a todos sin saber «${secretWord}»!`,
          };
        } else {
          reactionsByMonster[m.id] = {
            emotion: "sorprendido",
            text: fooledLines[lineIdx++ % fooledLines.length],
          };
        }
      });
    }

    // Mostrar todos los bocadillos y etiquetas de rol revelado en los 4 asientos
    window.MONSTER_PROFILES.forEach((m) => {
      const card = document.getElementById(`monster-card-${m.id}`);
      const isThisIntruder = m.id === intruderId;
      card?.classList.remove("active-turn", "votable-target");
      card?.classList.add(
        "finale-commenting",
        isThisIntruder ? "revealed-intruder" : "revealed-innocent"
      );

      this._setMonsterVoteBadge(
        m.id,
        isThisIntruder ? "🎭 ERA EL INTRUSO" : "🛡️ ERA INOCENTE"
      );

      const r = reactionsByMonster[m.id] || {
        emotion: "normal",
        text: `¡Qué gran partida con «${secretWord}»!`,
      };
      window.monsterAnimator.setEmotion(m.id, r.emotion);

      const bubbleEl = document.getElementById(`bubble-${m.id}`);
      if (bubbleEl) {
        bubbleEl.innerHTML = r.text;
        bubbleEl.classList.remove("hidden");
        bubbleEl.classList.add("finale-bubble");
      }
    });
  }

  _spawnConfetti(colors) {
    const layer = document.getElementById("finale-confetti-layer");
    if (!layer) return;
    layer.innerHTML = "";
    layer.classList.remove("hidden");

    const count = 38;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement("span");
      piece.className = "confetti-piece";
      piece.style.left = `${Math.random() * 98}%`;
      piece.style.backgroundColor = colors[i % colors.length];
      piece.style.animationDuration = `${2.2 + Math.random() * 2.1}s`;
      piece.style.animationDelay = `${Math.random() * 0.6}s`;
      layer.appendChild(piece);
    }
  }

  _clearConfetti() {
    const layer = document.getElementById("finale-confetti-layer");
    if (!layer) return;
    layer.innerHTML = "";
    layer.classList.add("hidden");
  }

  async _waitTurnPacing(ms) {
    this._setPacingControlsVisible(true);

    if (this.pacingMode === "step" || this.isPaused) {
      await new Promise((resolve) => {
        this._stepResolver = resolve;
      });
      return;
    }

    await new Promise((resolve) => {
      this._stepResolver = resolve;
      setTimeout(() => {
        if (!this.isPaused && this._stepResolver === resolve) {
          this._stepResolver = null;
          resolve();
        }
      }, ms);
    });
  }

  _setPacingControlsVisible(visible) {
    const btnPause = document.getElementById("btn-pause-toggle");
    const btnNext = document.getElementById("btn-next-step");
    if (!btnPause || !btnNext) return;
    if (visible) {
      btnPause.classList.toggle("hidden", this.pacingMode === "step");
      btnNext.classList.remove("hidden");
    } else {
      btnPause.classList.add("hidden");
      btnNext.classList.add("hidden");
    }
  }

  _redactSecretLeak(text) {
    if (!text || !this.state.secretWord) return text;
    const secret = this.state.secretWord.trim();
    if (secret.length < 3) return text;
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "gi");
    return String(text).replace(regex, "«la palabra secreta»");
  }

  _updateScoreboard() {
    const elHuman = document.getElementById("score-human");
    const elAI = document.getElementById("score-ai");
    const elMatches = document.getElementById("score-matches");
    if (elHuman) elHuman.textContent = String(this.score.humanWins);
    if (elAI) elAI.textContent = String(this.score.aiWins);
    if (elMatches) elMatches.textContent = String(this.score.matchesPlayed);
  }

  _waitForHumanClue() {
    const input = document.getElementById("human-clue-input");
    input?.focus();
    return new Promise((resolve) => {
      this._humanClueResolver = resolve;
    });
  }

  _handleHumanClueSubmit() {
    const input = document.getElementById("human-clue-input");
    const raw = (input?.value || "").trim();
    if (!raw) return;

    if (
      this.state.intruderId !== "human" &&
      this._compareWords(raw, this.state.secretWord)
    ) {
      alert(
        `¡Cuidado! No puedes decir directamente la palabra secreta («${this.state.secretWord}»). Di una pista relacionada.`
      );
      return;
    }

    input.value = "";
    if (this._humanClueResolver) {
      const r = this._humanClueResolver;
      this._humanClueResolver = null;
      r(raw);
    }
  }

  _waitForHumanDebate() {
    const input = document.getElementById("human-debate-input");
    input?.focus();
    return new Promise((resolve) => {
      this._humanDebateResolver = resolve;
    });
  }

  _handleHumanDebateSubmit(skipped) {
    const input = document.getElementById("human-debate-input");
    const text = skipped ? "" : (input?.value || "").trim();
    if (input) input.value = "";

    if (text) {
      window.soundEngine?.playChipDrop();
      this.state.publicDebate.push({
        speakerId: "human",
        speakerName: "Tú",
        comment: text,
        suspectId: null,
      });
      this._renderClueHistory();
    }

    if (this._humanDebateResolver) {
      const r = this._humanDebateResolver;
      this._humanDebateResolver = null;
      r();
    }
  }

  _recordPublicClue(entry) {
    this.state.publicClues.push(entry);
    if (entry.speakerId === "human") {
      const hc = document.getElementById("human-chips-row");
      if (hc) {
        const span = document.createElement("span");
        span.className = "table-clue-chip";
        span.textContent = `🃏 R${entry.round}: ${entry.word}`;
        hc.appendChild(span);
      }
    } else {
      this._addMonsterChip(entry.speakerId, `🃏 R${entry.round}: ${entry.word}`);
    }
    this._renderClueHistory();
  }

  _renderClueHistory() {
    const listEl = document.getElementById("public-clues-list");
    if (!listEl) return;

    if (
      this.state.publicClues.length === 0 &&
      this.state.publicDebate.length === 0
    ) {
      listEl.innerHTML = `<div class="empty-log">Aún no se han jugado pistas en la mesa.</div>`;
      return;
    }

    const cluesHtml = this.state.publicClues
      .map(
        (c, idx) => `
        <div class="clue-log-item ${c.speakerId === "human" ? "clue-human" : ""}">
          <span class="clue-num">#${idx + 1} (R${c.round})</span>
          <strong class="clue-speaker">${this._escapeHtml(c.speakerName)}:</strong>
          <span class="clue-word-pill">${this._escapeHtml(c.word)}</span>
        </div>`
      )
      .join("");

    const debateHtml =
      this.state.publicDebate.length > 0
        ? `<div class="debate-log-divider">🗣️ Debate en la Mesa</div>` +
          this.state.publicDebate
            .map(
              (d) => `
          <div class="debate-log-item">
            <strong>${this._escapeHtml(d.speakerName)}:</strong> «${this._escapeHtml(d.comment)}»
          </div>`
            )
            .join("")
        : "";

    listEl.innerHTML = cluesHtml + debateHtml;
    listEl.scrollTop = listEl.scrollHeight;
  }

  _highlightActiveSpeaker(playerId) {
    window.MONSTER_PROFILES.forEach((m) => {
      const card = document.getElementById(`monster-card-${m.id}`);
      card?.classList.toggle("active-turn", m.id === playerId);
    });
  }

  _clearAllSpeechBubbles() {
    window.MONSTER_PROFILES.forEach((m) => {
      this._setMonsterBubble(m.id, "");
    });
  }

  _setMonsterBubble(monsterId, html) {
    const el = document.getElementById(`bubble-${monsterId}`);
    if (!el) return;
    el.classList.remove("finale-bubble");
    if (!html) {
      el.classList.add("hidden");
      el.innerHTML = "";
    } else {
      el.innerHTML = html;
      el.classList.remove("hidden");
    }
  }

  _addMonsterChip(monsterId, text) {
    const container = document.getElementById(`chips-${monsterId}`);
    if (!container) return;
    const span = document.createElement("span");
    span.className = "table-clue-chip";
    span.textContent = text;
    container.appendChild(span);
  }

  _clearMonsterChips(monsterId) {
    const container = document.getElementById(`chips-${monsterId}`);
    if (container) container.innerHTML = "";
  }

  _setMonsterVoteBadge(monsterId, text) {
    const badge = document.getElementById(`vote-badge-${monsterId}`);
    if (!badge) return;
    if (!text) {
      badge.classList.add("hidden");
      badge.textContent = "";
    } else {
      badge.textContent = text;
      badge.classList.remove("hidden");
    }
  }

  _showOnlyTablePanel(activePanelId) {
    [
      "panel-table-idle",
      "panel-human-clue",
      "panel-human-debate",
      "panel-voting-prompt",
      "panel-round-elimination",
      "panel-human-last-chance",
      "panel-match-summary",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.toggle("hidden", id !== activePanelId);
      }
    });
  }

  _setIdlePanelText(title, subtitle) {
    const t = document.getElementById("idle-title");
    const s = document.getElementById("idle-subtitle");
    if (t) t.textContent = title;
    if (s) s.textContent = subtitle;
  }

  _clearPendingResolvers() {
    this._humanClueResolver = null;
    this._humanDebateResolver = null;
    this._humanVoteResolver = null;
    this._humanLastChanceResolver = null;
    this._stepResolver = null;
    this._nextSurvivalRoundResolver = null;
  }

  _updateStatusBanner(html) {
    const banner = document.getElementById("game-status-banner");
    if (banner) banner.innerHTML = html;
  }

  /**
   * Permite previsualizar estados clave mediante ?test_state=... para verificar con capturas
   * que ningún texto o botón se machaca en distintas resoluciones.
   */
  _applyVisualTestState(mode) {
    this.state.secretWord = "Tormenta";
    this.state.secretCategory = "Naturaleza";
    this.state.roundNum = 1;
    this.state.intruderId = mode.includes("human_intruder") || mode === "finale_steal" ? "human" : "kiko";
    this.state.turnOrder = ["buba", "human", "kiko", "momo", "zorg"];
    this._renderSecretRoleCard();
    this._renderTurnBadgesOnSeats();

    ["buba", "kiko", "momo", "zorg"].forEach((id, i) => {
      const sampleWords = ["Trueno", "Brisa", "Paraguas", "Relámpago"];
      this._recordPublicClue({
        round: 1,
        speakerId: id,
        speakerName: id.charAt(0).toUpperCase() + id.slice(1),
        word: sampleWords[i],
        reaction: "",
      });
    });

    this.state.votes = {
      human: { targetId: "kiko", reason: "Dijo brisa y era muy suave." },
      buba: { targetId: "kiko", reason: "Su pista no encaja con el temporal." },
      kiko: { targetId: "momo", reason: "Intenté defenderme." },
      momo: { targetId: "kiko", reason: "Kiko dudó demasiado." },
      zorg: { targetId: "kiko", reason: "Estaba fingiendo claramente." },
    };

    if (mode === "clues") {
      this._highlightActiveSpeaker("buba");
      this._setMonsterBubble(
        "buba",
        "🃏 Pista R1: «<strong>Trueno</strong>»<br><small>¡El cielo retumba fuerte!</small>"
      );
      this._showOnlyTablePanel("panel-human-clue");
      this._updateStatusBanner(
        "🎯 Ronda 1 (Turno 2/5) · ¡Es tu turno! Escribe una palabra pista."
      );
    } else if (mode === "debate") {
      this._highlightActiveSpeaker("momo");
      window.monsterAnimator.setEmotion("momo", "enfadado");
      this._setMonsterBubble(
        "momo",
        "💬 «Kiko ha dicho Brisa y eso es demasiado suave para esta palabra...»"
      );
      this._showOnlyTablePanel("panel-human-debate");
      this._updateStatusBanner(
        "🗣️ Tu turno en el Debate (Ronda 1): escribe una acusación o pasa directo a votar."
      );
    } else if (mode === "voting") {
      this._showOnlyTablePanel("panel-voting-prompt");
      window.MONSTER_PROFILES.forEach((m) => {
        document.getElementById(`monster-card-${m.id}`)?.classList.add("votable-target");
      });
      this._updateStatusBanner(
        "🗳️ Votación de la Ronda 1: Haz clic sobre uno de los 4 monstruos activos para votar."
      );
    } else if (mode === "last_chance") {
      this.state.intruderId = "human";
      this._renderSecretRoleCard();
      window.monsterAnimator.setAllEmotions("enfadado");
      this._setMonsterBubble("zorg", "😠 «¡Te hemos cazado! A ver si sabes nuestra palabra...»");
      this._showOnlyTablePanel("panel-human-last-chance");
      this._updateStatusBanner(
        "😱 ¡Te han descubierto en la votación! Pero tienes una ÚLTIMA OPORTUNIDAD: ¡adivina la palabra secreta y roba la partida!"
      );
    } else if (mode === "human_eliminated") {
      this.state.eliminatedIds = ["human"];
      this._renderTurnBadgesOnSeats();
      this._showRoundEliminationModal({
        title: "😱 ¡Te han expulsado siendo INOCENTE!",
        body: "Los monstruos te han votado por error y el <strong>Intruso sigue oculto</strong> entre los 4 supervivientes. Pulsa <strong>«⚡ Resolver la Partida»</strong> para descubrir quién gana o sigue observando.",
      });
      this._updateStatusBanner(
        "😱 ¡Te han expulsado con 3 votos siendo INOCENTE! Pulsa «⚡ Resolver la Partida» para ver el desenlace final."
      );
    } else if (mode === "finale_win") {
      this._finishMatch({
        intruderCaught: true,
        intruderGuessedWord: false,
        guessedWordText: "Viento",
      });
    } else if (mode === "finale_steal") {
      this.state.intruderId = "human";
      this._finishMatch({
        intruderCaught: true,
        intruderGuessedWord: true,
        guessedWordText: "Tormenta",
      });
    } else if (mode === "finale_loss") {
      this.state.intruderId = "kiko";
      this.state.eliminatedIds = ["human", "buba"];
      this._finishMatch({
        intruderCaught: false,
        intruderGuessedWord: false,
        guessedWordText: null,
        eliminatedLastName: "Buba",
      });
    }
  }

  _sanitizeClueWord(str) {
    return String(str)
      .replace(/^["'«»]+|["'«».!]+$/g, "")
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join(" ");
  }

  _normalizeWord(w) {
    return String(w || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9ñ]/g, "")
      .trim();
  }

  _compareWords(a, b) {
    const na = this._normalizeWord(a);
    const nb = this._normalizeWord(b);
    if (!na || !nb) return false;
    return na === nb || (na.length >= 4 && (na.includes(nb) || nb.includes(na)));
  }

  _escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  window.intrusoGame = new IntrusoGame();
  window.intrusoGame.init();
});
