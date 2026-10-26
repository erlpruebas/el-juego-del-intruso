/**
 * Motor de Animación de los 4 Monstruos ("El Juego del Intruso").
 *
 * Cada monstruo ("buba", "kiko", "momo", "zorg") dispone de:
 * - 3 emociones: "normal", "enfadado", "sorprendido"
 * - 3 fotogramas por emoción: 1, 2, 3 (generados sobre fondo verde #00FF00 y procesados sin fondo)
 *
 * El motor alterna entre los 3 fotogramas en patrón ping-pong (1 -> 2 -> 3 -> 2)
 * a velocidad rápida cuando el personaje habla o reacciona, y a velocidad suave en reposo.
 */

window.MONSTER_PROFILES = [
  {
    id: "buba",
    name: "Buba",
    title: "El Peludo Azul",
    color: "#3b82f6",
    accent: "#a855f7",
    seat: "seat-left",
    personality:
      "Entusiasta, expresivo, espontáneo y un poco impulsivo. Usa expresiones coloquiales divertidas y se emociona rápido.",
  },
  {
    id: "kiko",
    name: "Kiko",
    title: "Tres Ojos",
    color: "#f97316",
    accent: "#eab308",
    seat: "seat-top-left",
    personality:
      "Analítico, muy observador y desconfiado. Siempre dice que sus tres ojos lo ven todo y busca fallos lógicos en las pistas de los demás.",
  },
  {
    id: "momo",
    name: "Momo",
    title: "Antenitas",
    color: "#ec4899",
    accent: "#38bdf8",
    seat: "seat-top-right",
    personality:
      "Ingeniosa, juguetona, creativa y pícara. Le gusta dar pistas elegantes o poéticas y sospecha de quienes dicen palabras demasiado obvias.",
  },
  {
    id: "zorg",
    name: "Zorg",
    title: "El Cíclope",
    color: "#ef4444",
    accent: "#8b5cf6",
    seat: "seat-right",
    personality:
      "Teatral, dramático, misterioso y acusador. Habla como un detective clásico con bombín que cree haber resuelto el caso.",
  },
];

class MonsterAnimator {
  constructor() {
    this.monsters = {};
    this.useGreenScreenRaw = false; // false = usa PNG transparente sin croma; true = muestra el fondo verde #00FF00 original
    this.pingPongSequence = [1, 2, 3, 2];
    this.cache = new Map();

    window.MONSTER_PROFILES.forEach((m, idx) => {
      this.monsters[m.id] = {
        id: m.id,
        emotion: "normal",
        seqIndex: idx % 4,
        talking: false,
        lastTick: performance.now() + idx * 130,
        imgElement: null,
        cardElement: null,
        emotionBadgeElement: null,
      };
    });

    this._rafId = null;
  }

  preloadAll() {
    const emotions = ["normal", "enfadado", "sorprendido"];
    const frames = [1, 2, 3];
    const folders = ["assets/sprites", "assets/sprites_green"];

    for (const folder of folders) {
      for (const m of window.MONSTER_PROFILES) {
        for (const emo of emotions) {
          for (const f of frames) {
            const url = `${folder}/${m.id}_${emo}_${f}.png`;
            const img = new Image();
            img.src = url;
            this.cache.set(url, img);
          }
        }
      }
    }
  }

  bindDOM() {
    for (const m of window.MONSTER_PROFILES) {
      const state = this.monsters[m.id];
      state.imgElement = document.getElementById(`sprite-${m.id}`);
      state.cardElement = document.getElementById(`monster-card-${m.id}`);
      state.emotionBadgeElement = document.getElementById(`emotion-badge-${m.id}`);
      this._updateSpriteSrc(m.id);
    }
  }

  setGreenScreenMode(enabled) {
    this.useGreenScreenRaw = Boolean(enabled);
    for (const m of window.MONSTER_PROFILES) {
      const card = this.monsters[m.id].cardElement;
      if (card) {
        card.classList.toggle("chroma-raw-mode", this.useGreenScreenRaw);
      }
      this._updateSpriteSrc(m.id);
    }
  }

  setEmotion(monsterId, emotion) {
    const state = this.monsters[monsterId];
    if (!state) return;
    const valid = ["normal", "enfadado", "sorprendido"].includes(emotion)
      ? emotion
      : "normal";
    state.emotion = valid;

    if (state.cardElement) {
      state.cardElement.setAttribute("data-emotion", valid);
    }
    if (state.emotionBadgeElement) {
      const labels = {
        normal: "😊 Normal",
        enfadado: "😠 Alerta",
        sorprendido: "😱 ¡Oh!",
      };
      state.emotionBadgeElement.textContent = labels[valid] || "😊 Normal";
      state.emotionBadgeElement.className = `emotion-badge emotion-${valid}`;
    }
    this._updateSpriteSrc(monsterId);
  }

  setAllEmotions(emotion) {
    for (const m of window.MONSTER_PROFILES) {
      this.setEmotion(m.id, emotion);
    }
  }

  setTalking(monsterId, isTalking) {
    const state = this.monsters[monsterId];
    if (!state) return;
    state.talking = Boolean(isTalking);
    if (state.cardElement) {
      state.cardElement.classList.toggle("is-speaking", state.talking);
    }
    if (!state.talking) {
      state.seqIndex = 0; // vuelve al frame 1 (boca más cerrada/reposo)
      this._updateSpriteSrc(monsterId);
    }
  }

  _updateSpriteSrc(monsterId, explicitFrame = null) {
    const state = this.monsters[monsterId];
    if (!state || !state.imgElement) return;
    const frameNum =
      explicitFrame || this.pingPongSequence[state.seqIndex % this.pingPongSequence.length];
    const folder = this.useGreenScreenRaw ? "assets/sprites_green" : "assets/sprites";
    const nextSrc = `${folder}/${monsterId}_${state.emotion}_${frameNum}.png`;
    if (state.imgElement.getAttribute("data-current-src") !== nextSrc) {
      state.imgElement.src = nextSrc;
      state.imgElement.setAttribute("data-current-src", nextSrc);
    }
  }

  startLoop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    const tick = (now) => {
      for (const m of window.MONSTER_PROFILES) {
        const state = this.monsters[m.id];

        // Si el motor de sonido está reproduciendo la voz de este monstruo, sincronizar la boca en tiempo real con el volumen del audio
        if (
          state.talking &&
          window.soundEngine &&
          window.soundEngine.activeMonsterId === m.id
        ) {
          const liveFrame = window.soundEngine.getLiveMouthFrame();
          if (liveFrame) {
            this._updateSpriteSrc(m.id, liveFrame);
            continue;
          }
        }

        const interval = state.talking
          ? 145
          : state.emotion !== "normal"
          ? 340
          : 620;

        if (now - state.lastTick >= interval) {
          state.lastTick = now;
          state.seqIndex = (state.seqIndex + 1) % this.pingPongSequence.length;
          this._updateSpriteSrc(m.id);
        }
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }
}

window.monsterAnimator = new MonsterAnimator();
