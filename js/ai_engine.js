/**
 * Motor de IA con Aislamiento Estricto para "El Juego del Intruso".
 * Configurado exclusivamente con Google Gemini 3.8 Flash (`gemini-3.8-flash`).
 *
 * Modos de ejecución:
 * - Modo Local (`server.py`): Llama a `/api/agent-turn`, que lee la clave desde `D:\intruso\.env`.
 * - Modo GitHub Pages: Llama directamente a `gemini-3.8-flash` decodificando la variable inyectada
 *   desde GitHub Actions Secrets (`GEMINI_API_KEY`).
 */

class IsolatedAIEngine {
  constructor() {
    this.mode = "local_server"; // "local_server" | "browser_direct"
    this.selectedProviderModel = "gemini:gemini-3.8-flash";
    this.auditLog = [];
  }

  async detectEnvironment() {
    try {
      const resp = await fetch("/api/config", { method: "GET" });
      if (resp.ok) {
        const data = await resp.json();
        this.mode = "local_server";
        return data;
      }
    } catch (_) {}
    this.mode = "browser_direct";
    return { ok: true, mode: "browser_direct" };
  }

  clearAuditLog() {
    this.auditLog = [];
  }

  _resolveGeminiKey() {
    // 1. Clave ofuscada inyectada en build por GitHub Actions desde secrets.GEMINI_API_KEY
    if (window.__INTRUSO_VAULT__ && Array.isArray(window.__INTRUSO_VAULT__)) {
      try {
        return window.__INTRUSO_VAULT__
          .map((code, idx) => String.fromCharCode(code ^ ((idx * 31 + 73) & 0xff)))
          .join("");
      } catch (_) {}
    }
    // 2. Fallback si se definió directamente
    if (window.GITHUB_INJECTED_GEMINI_KEY) {
      return window.GITHUB_INJECTED_GEMINI_KEY;
    }
    return localStorage.getItem("INTRUSO_GEMINI_KEY") || "";
  }

  buildIsolatedContext({
    agentProfile,
    agentRole,
    secretWord,
    phase,
    roundNum,
    publicClues,
    publicDebate,
    validTargets,
  }) {
    const isIntruder = agentRole === "intruso";

    return {
      agent_id: agentProfile.id,
      agent_name: agentProfile.name,
      agent_personality: agentProfile.personality,
      role: isIntruder ? "intruso" : "inocente",
      secret_word: isIntruder ? null : secretWord,
      phase,
      round_num: roundNum,
      public_clues: publicClues.map((c) => ({
        round: c.round,
        speakerId: c.speakerId,
        speakerName: c.speakerName,
        word: c.word,
      })),
      public_debate: publicDebate.map((d) => ({
        speakerId: d.speakerId,
        speakerName: d.speakerName,
        comment: d.comment,
      })),
      valid_targets: validTargets.map((t) => ({
        id: t.id,
        name: t.name,
      })),
      provider_model: "gemini:gemini-3.8-flash",
    };
  }

  async runAgentTurn(isolatedPayload) {
    if (this.mode === "local_server") {
      try {
        const resp = await fetch("/api/agent-turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(isolatedPayload),
        });
        const data = await resp.json();
        if (data.ok && data.result) {
          this.auditLog.push({
            timestamp: new Date().toLocaleTimeString(),
            ...data.audit,
            response: data.result,
            latency_ms: data.latency_ms,
          });
          return data.result;
        }
      } catch (err) {
        console.warn("Pasando a llamada directa Gemini 3.8 Flash:", err);
      }
    }

    return await this._runBrowserDirectGemini(isolatedPayload);
  }

  async _runBrowserDirectGemini(payload) {
    const key = this._resolveGeminiKey();
    if (!key) {
      throw new Error("Falta la variable GEMINI_API_KEY en GitHub Secrets.");
    }

    const { systemPrompt, userPrompt } = this._buildClientPrompts(payload);
    const models = ["gemini-3.8-flash", "gemini-2.5-flash"];

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            generationConfig: {
              temperature: 0.75,
              maxOutputTokens: 800,
              responseMimeType: "application/json",
            },
          }),
        });
        if (!r.ok) continue;
        const j = await r.json();
        const text = j.candidates[0].content.parts[0].text;
        const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        return JSON.parse(cleaned);
      } catch (_) {}
    }

    throw new Error("No se pudo conectar con Gemini 3.8 Flash.");
  }

  _buildClientPrompts(payload) {
    const isIntruder = payload.role === "intruso";
    const secretWord = isIntruder ? null : payload.secret_word;
    const cluesText =
      payload.public_clues.length > 0
        ? payload.public_clues
            .map(
              (c, i) =>
                `  - Turno ${i + 1} (Ronda ${c.round}): ${c.speakerName} dijo "${c.word}"`
            )
            .join("\n")
        : "  (Ninguna pista dicha todavía)";
    const debateText =
      payload.public_debate.length > 0
        ? payload.public_debate.map((d) => `  - ${d.speakerName}: "${d.comment}"`).join("\n")
        : "  (Sin comentarios previos)";

    const systemPrompt =
      `Eres ${payload.agent_name}, jugando a 'El Juego del Intruso' en español.\n` +
      `Personalidad: ${payload.agent_personality}\n` +
      `REGLA DE AISLAMIENTO: Solo conoces tu rol y lo dicho públicamente en la mesa. Sé muy breve y directo. Responde SOLO en JSON válido.`;

    const roleBlock = isIntruder
      ? `🎭 ERES EL INTRUSO. NO conoces la palabra secreta. Deduce el tema por las pistas de la mesa y di una palabra creíble para pasar desapercibido.`
      : `🛡️ ERES UN JUGADOR INOCENTE. La palabra secreta es "${secretWord}". Da una pista sutil de 1 palabra relacionada sin revelar directamente la palabra secreta al intruso.`;

    let userPrompt = "";
    if (payload.phase === "clue") {
      userPrompt =
        `${roleBlock}\n\nPistas en la mesa:\n${cluesText}\n\n` +
        `PROHIBIDO repetir pistas dichas` +
        (secretWord ? ` o decir "${secretWord}".\n` : `.\n`) +
        `Devuelve JSON (short_reaction de máximo 7 palabras): {"word": "UnaPalabra", "emotion": "normal", "short_reaction": "Frase muy corta"}`;
    } else if (payload.phase === "debate") {
      userPrompt =
        `${roleBlock}\n\nPistas:\n${cluesText}\n\nDebate:\n${debateText}\n\n` +
        `Acusa o comenta sospechas en 1 frase corta (MÁXIMO 12 PALABRAS) mencionando a otro jugador (${payload.valid_targets
          .map((t) => t.name)
          .join(", ")}). ` +
        (secretWord ? `PROHIBIDO decir "${secretWord}".\n` : `\n`) +
        `Devuelve JSON: {"comment": "Frase corta máx 12 palabras", "suspect_id": "id", "emotion": "enfadado"}`;
    } else if (payload.phase === "vote") {
      userPrompt =
        `${roleBlock}\n\nPistas:\n${cluesText}\n\nDebate:\n${debateText}\n\n` +
        `Vota a uno de: ${payload.valid_targets
          .map((t) => `${t.name} (id: "${t.id}")`)
          .join(", ")}. Razón de MÁXIMO 10 PALABRAS.` +
        (secretWord ? ` PROHIBIDO decir "${secretWord}".\n` : `\n`) +
        `Devuelve JSON: {"vote_id": "id_elegido", "reason": "Razón corta máx 10 palabras", "emotion": "enfadado"}`;
    } else {
      userPrompt =
        `¡Te han descubierto como Intruso! Última oportunidad: adivina la palabra secreta exacta según las pistas:\n${cluesText}\n` +
        `Devuelve JSON (comment de máximo 10 palabras): {"guessed_word": "Palabra", "comment": "Frase corta máx 10 palabras", "emotion": "sorprendido"}`;
    }

    return { systemPrompt, userPrompt };
  }
}

window.aiEngine = new IsolatedAIEngine();
