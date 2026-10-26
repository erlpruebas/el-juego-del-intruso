/**
 * Motor de Sonido, Música Ambiental y Voces de Monstruo para "El Juego del Intruso".
 *
 * Incluye:
 * 1. Música de fondo estilo "Club Secreto / Detective Lounge" (bajo caminante + acordes de vibráfono/Rhodes
 *    + escobillas suaves) con auto-ducking (baja suavemente el volumen cuando habla un monstruo).
 * 2. Reproducción de los 12 clips vocales generados con Google Gemini TTS (`assets/audio/<id>_<emotion>.wav`)
 *    para Buba, Kiko, Momo y Zorg en sus 3 emociones (normal, enfadado, sorprendido).
 * 3. Sincronización labial en tiempo real (Lip-Sync con `AnalyserNode`).
 * 4. Efectos de sonido de juego de mesa.
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.dataArray = null;
    this.enabled = true;
    this.musicEnabled = true;
    this.musicPlaying = false;
    this.musicTimer = null;
    this.musicStep = 0;
    this.volume = 0.85;
    this.audioBuffers = new Map();
    this.activeMonsterId = null;

    this.voiceProfiles = {
      buba: { baseFreq: 195, formant: 620, wave: "triangle", speed: 0.085 },
      kiko: { baseFreq: 285, formant: 980, wave: "sawtooth", speed: 0.072 },
      momo: { baseFreq: 330, formant: 1150, wave: "sine", speed: 0.078 },
      zorg: { baseFreq: 125, formant: 420, wave: "sawtooth", speed: 0.095 },
    };
  }

  _ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.45;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.14;

      this.analyser.connect(this.masterGain);
      this.musicGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.enabled ? this.volume : 0.0001,
        this.ctx.currentTime,
        0.05
      );
    }
  }

  setMusicEnabled(enabled) {
    this.musicEnabled = Boolean(enabled);
    if (this.musicEnabled) {
      this.startMusic();
    } else {
      this.stopMusic();
    }
  }

  /**
   * Inicia la musiquilla ambiental estilo "Club de Detectives / Lounge Misterioso".
   * Se atenúa automáticamente cuando habla un monstruo para que las voces se escuchen nítidas.
   */
  startMusic() {
    if (!this.musicEnabled || this.musicPlaying) return;
    this._ensureContext();
    this.musicPlaying = true;

    // Progresión en La menor séptima / Re menor / Mi séptima (Groove misterioso y simpático)
    const bassLine = [
      110.0, 130.81, 146.83, 164.81, // Am
      146.83, 164.81, 174.61, 196.0, // Dm
      110.0, 130.81, 146.83, 155.56, // Am / Eb blue note
      164.81, 146.83, 130.81, 123.47, // E7 turnaround
    ];

    const chords = [
      [261.63, 329.63, 392.0, 440.0], // Am7
      [293.66, 349.23, 440.0, 523.25], // Dm7
      [261.63, 329.63, 392.0, 440.0], // Am7
      [246.94, 329.63, 415.3, 493.88], // E7
    ];

    const stepDurationMs = 360; // ~83 BPM swing ligero

    const playTick = () => {
      if (!this.musicPlaying || !this.musicEnabled) return;
      if (!this.enabled || !this.ctx || this.ctx.state !== "running") {
        this.musicTimer = setTimeout(playTick, stepDurationMs);
        return;
      }

      const now = this.ctx.currentTime;
      const step = this.musicStep % 16;
      const bar = Math.floor(step / 4);

      // Si un monstruo está hablando, bajamos suavemente el volumen de la música (ducking)
      const targetMusicVol = this.activeMonsterId ? 0.045 : 0.135;
      this.musicGain.gain.setTargetAtTime(targetMusicVol, now, 0.08);

      // 1. Bajo caminante (Walking Bass suave) en cada pulso par
      if (step % 2 === 0) {
        const bassFreq = bassLine[step % bassLine.length];
        const bOsc = this.ctx.createOscillator();
        const bFilter = this.ctx.createBiquadFilter();
        const bGain = this.ctx.createGain();

        bOsc.type = "triangle";
        bOsc.frequency.setValueAtTime(bassFreq, now);

        bFilter.type = "lowpass";
        bFilter.frequency.setValueAtTime(360, now);

        bGain.gain.setValueAtTime(0.001, now);
        bGain.gain.linearRampToValueAtTime(0.55, now + 0.03);
        bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);

        bOsc.connect(bFilter);
        bFilter.connect(bGain);
        bGain.connect(this.musicGain);

        bOsc.start(now);
        bOsc.stop(now + 0.6);
      }

      // 2. Acorde de Vibráfono / Piano eléctrico suave en el pulso 0 y 3 de cada compás
      if (step % 4 === 0 || step % 4 === 3) {
        const chordNotes = chords[bar % chords.length];
        chordNotes.forEach((freq, idx) => {
          const cOsc = this.ctx.createOscillator();
          const cGain = this.ctx.createGain();
          cOsc.type = "sine";
          cOsc.frequency.setValueAtTime(freq, now + idx * 0.015);

          const amp = step % 4 === 0 ? 0.16 : 0.1;
          cGain.gain.setValueAtTime(0.001, now + idx * 0.015);
          cGain.gain.linearRampToValueAtTime(amp, now + idx * 0.015 + 0.02);
          cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.52);

          cOsc.connect(cGain);
          cGain.connect(this.musicGain);
          cOsc.start(now + idx * 0.015);
          cOsc.stop(now + 0.55);
        });
      }

      // 3. Toque de marimba / pizzicato juguetón ocasional
      if (step % 4 === 2 && Math.random() < 0.75) {
        const chordNotes = chords[bar % chords.length];
        const note = chordNotes[Math.floor(Math.random() * chordNotes.length)] * 2;
        const mOsc = this.ctx.createOscillator();
        const mGain = this.ctx.createGain();
        mOsc.type = "sine";
        mOsc.frequency.setValueAtTime(note, now);
        mGain.gain.setValueAtTime(0.001, now);
        mGain.gain.linearRampToValueAtTime(0.11, now + 0.015);
        mGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        mOsc.connect(mGain);
        mGain.connect(this.musicGain);
        mOsc.start(now);
        mOsc.stop(now + 0.24);
      }

      this.musicStep++;
      this.musicTimer = setTimeout(playTick, stepDurationMs);
    };

    playTick();
  }

  stopMusic() {
    this.musicPlaying = false;
    if (this.musicTimer) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
  }

  async preloadMonsterClips() {
    const monsters = ["buba", "kiko", "momo", "zorg"];
    const emotions = ["normal", "enfadado", "sorprendido"];

    for (const m of monsters) {
      for (const emo of emotions) {
        const key = `${m}_${emo}`;
        const url = `assets/audio/${key}.wav`;
        try {
          const resp = await fetch(url);
          if (resp.ok) {
            const arrayBuf = await resp.arrayBuffer();
            this.audioBuffers.set(key, arrayBuf);
          }
        } catch (_) {}
      }
    }
  }

  getLiveMouthFrame() {
    if (!this.enabled || !this.analyser || !this.activeMonsterId) {
      return null;
    }
    this.analyser.getByteTimeDomainData(this.dataArray);
    let sumSq = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      const norm = (this.dataArray[i] - 128) / 128.0;
      sumSq += norm * norm;
    }
    const rms = Math.sqrt(sumSq / this.dataArray.length);

    if (rms < 0.025) return 1;
    if (rms < 0.095) return 2;
    return 3;
  }

  async playMonsterVoice(monsterId, emotion = "normal", spokenText = "") {
    if (!this.enabled) {
      await this._sleep(1000);
      return;
    }
    this._ensureContext();
    this.activeMonsterId = monsterId;

    const key = `${monsterId}_${emotion}`;
    let playedClipDurationMs = 0;

    if (this.audioBuffers.has(key)) {
      try {
        const rawCopy = this.audioBuffers.get(key).slice(0);
        const decoded = await this.ctx.decodeAudioData(rawCopy);
        const source = this.ctx.createBufferSource();
        source.buffer = decoded;
        source.playbackRate.value = 0.96 + Math.random() * 0.08;
        source.connect(this.analyser);
        source.start(0);
        playedClipDurationMs = Math.min(
          2100,
          Math.round((decoded.duration / source.playbackRate.value) * 1000)
        );
      } catch (_) {
        playedClipDurationMs = 0;
      }
    }

    if (playedClipDurationMs > 0) {
      await this._sleep(playedClipDurationMs);
    } else {
      await this._playSyllableMumble(monsterId, emotion, spokenText || "buba");
    }

    this.activeMonsterId = null;
  }

  async _playSyllableMumble(monsterId, emotion, text) {
    this._ensureContext();
    const prof = this.voiceProfiles[monsterId] || this.voiceProfiles.buba;
    const clean = String(text).replace(/[^a-záéíóúñü]/gi, " ").trim();
    const words = clean.split(/\s+/).filter(Boolean);
    const numSyllables = Math.min(10, Math.max(3, words.length * 2));

    let pitchMult = 1.0;
    if (emotion === "enfadado") pitchMult = 0.88;
    if (emotion === "sorprendido") pitchMult = 1.22;

    for (let i = 0; i < numSyllables; i++) {
      if (!this.enabled) break;
      const now = this.ctx.currentTime;
      const dur = prof.speed * (0.85 + Math.random() * 0.35);

      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = prof.wave;
      const f0 = prof.baseFreq * pitchMult * (0.92 + Math.random() * 0.22);
      osc.frequency.setValueAtTime(f0, now);
      osc.frequency.exponentialRampToValueAtTime(
        f0 * (emotion === "sorprendido" ? 1.25 : 0.94),
        now + dur
      );

      filter.type = "bandpass";
      filter.frequency.setValueAtTime(prof.formant * (0.85 + Math.random() * 0.3), now);
      filter.Q.value = 3.5;

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.32, now + dur * 0.2);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.analyser);

      osc.start(now);
      osc.stop(now + dur);

      await this._sleep(Math.round(dur * 1000) + 36);
    }
  }

  playThinkingHmm(monsterId) {
    if (!this.enabled) return;
    this._ensureContext();
    const prof = this.voiceProfiles[monsterId] || this.voiceProfiles.buba;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(prof.baseFreq * 0.9, now);
    osc.frequency.exponentialRampToValueAtTime(prof.baseFreq * 1.18, now + 0.22);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  playCardDeal() {
    if (!this.enabled) return;
    this._ensureContext();
    if (this.musicEnabled && !this.musicPlaying) {
      this.startMusic();
    }
    const notes = [261.63, 329.63, 392.0, 523.25];
    notes.forEach((freq, idx) => {
      const now = this.ctx.currentTime + idx * 0.075;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.3);
    });
  }

  playChipDrop() {
    if (!this.enabled) return;
    this._ensureContext();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.065);

    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.075);
  }

  playEmotionReaction(emotion) {
    if (!this.enabled) return;
    this._ensureContext();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    if (emotion === "enfadado") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(145, now);
      osc.frequency.linearRampToValueAtTime(110, now + 0.22);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (emotion === "sorprendido") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(760, now + 0.18);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.21);
    }
  }

  playVoteStamp() {
    if (!this.enabled) return;
    this._ensureContext();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(58, now + 0.16);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  playMatchEnd(humanWon) {
    if (!this.enabled) return;
    this._ensureContext();
    const seq = humanWon
      ? [392.0, 493.88, 587.33, 783.99]
      : [392.0, 369.99, 349.23, 293.66];
    seq.forEach((freq, i) => {
      const now = this.ctx.currentTime + i * 0.14;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.36);
    });
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

window.soundEngine = new SoundEngine();
