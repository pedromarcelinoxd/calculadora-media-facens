(() => {
  // ---------- Configuração ----------

  const PESOS_PADRAO = { ac1: 0.15, ac2: 0.30, ag: 0.10, af: 0.45 };
  const IDS = Object.keys(PESOS_PADRAO);
  const ROTULOS = { ac1: "AC1", ac2: "AC2", ag: "AG", af: "AF" };

  const MIN_MATERIAS = 1;
  const MAX_MATERIAS = 12;
  const MATERIAS_INICIAIS = 6;

  const CHAVE = "calc-media-facens-v3";
  const CHAVE_ANTIGA = "calc-media-facens-v2";

  const $ = (id) => document.getElementById(id);
  const raiz = document.documentElement;

  const formatar = (n) => n.toFixed(2).replace(".", ",");
  const formatar1 = (n) => n.toFixed(1).replace(".", ",");
  const formatarPorcentagem = (peso) =>
    String(Math.round(peso * 10000) / 100).replace(".", ",");

  const escaparHTML = (texto) =>
    String(texto).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);

  function interpretarNota(valor) {
    const texto = String(valor ?? "").trim().replace(",", ".");
    if (texto === "") return null;
    const numero = Number(texto);
    return Number.isFinite(numero) && numero >= 0 && numero <= 10 ? numero : NaN;
  }

  let proximoId = 1;
  const novaMateria = (dados = {}) => ({
    id: proximoId++,
    name: dados.name ?? "",
    ac1: dados.ac1 ?? "",
    ac2: dados.ac2 ?? "",
    ag: dados.ag ?? "",
    af: dados.af ?? "",
    as: dados.as ?? "", // Avaliação Substitutiva
    asAlvo: IDS.includes(dados.asAlvo) ? dados.asAlvo : "auto", // nota que a AS substitui
    faltas: dados.faltas ?? "",
    aulas: dados.aulas ?? "",
    sim: null, // valor do simulador da AF (não é salvo)
  });

  // Frequência mínima para não reprovar por falta (75% das aulas).
  const FREQUENCIA_MINIMA = 0.75;

  const pesosValidos = (p) =>
    p &&
    IDS.every((id) => Number.isFinite(p[id]) && p[id] >= 0 && p[id] <= 1) &&
    Math.abs(IDS.reduce((t, id) => t + p[id], 0) - 1) < 1e-6;

  // ---------- Estado ----------

  const estado = {
    materias: [],
    meta: "6,0",
    pesos: { ...PESOS_PADRAO },
  };

  function aplicarDados(dados) {
    const lista = Array.isArray(dados?.subjects) ? dados.subjects : [];
    estado.materias = lista
      .slice(0, MAX_MATERIAS)
      .map((m) => novaMateria(m));

    if (estado.materias.length < MIN_MATERIAS) {
      estado.materias = Array.from({ length: MATERIAS_INICIAIS }, () => novaMateria());
    }

    estado.meta = typeof dados?.meta === "string" ? dados.meta : "6,0";
    estado.pesos = pesosValidos(dados?.pesos) ? { ...dados.pesos } : { ...PESOS_PADRAO };
  }

  function carregarSalvo() {
    try {
      const atual = localStorage.getItem(CHAVE);
      if (atual) return JSON.parse(atual);
      // Primeira vez nesta versão: aproveita as notas da versão anterior.
      const antigo = localStorage.getItem(CHAVE_ANTIGA);
      return antigo ? JSON.parse(antigo) : null;
    } catch {
      return null;
    }
  }

  function exportarDados() {
    return {
      subjects: estado.materias.map(({ name, ac1, ac2, ag, af, as, asAlvo, faltas, aulas }) =>
        ({ name, ac1, ac2, ag, af, as, asAlvo, faltas, aulas })),
      meta: estado.meta,
      pesos: estado.pesos,
    };
  }

  function salvar() {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(exportarDados()));
    } catch {
      // Sem armazenamento a calculadora continua funcionando.
    }
  }

  const nomeDe = (materia, indice) => materia.name.trim() || `Matéria ${indice + 1}`;

  // ---------- Cálculo ----------

  function lerMeta() {
    const meta = interpretarNota(estado.meta);
    return { meta: meta === null || Number.isNaN(meta) ? 6 : meta, invalida: meta === null || Number.isNaN(meta) };
  }

  /**
   * Avaliação Substitutiva (AS): a nota dela entra no lugar de uma das notas
   * (a escolhida, ou a que mais ajuda em "auto"). Só vale se for maior que a original.
   */
  function avaliarAS(materia, notas, media, meta) {
    const P = estado.pesos;
    const nota = interpretarNota(materia.as);
    const alvos = (materia.asAlvo === "auto" ? IDS : [materia.asAlvo]).filter((id) => P[id] > 0);

    // Nota mínima na AS para passar, para cada nota que ela pode substituir.
    const opcoes = alvos.map((id) => {
      const semEla = media - notas[id] * P[id];
      return { id, precisa: Math.max(0, (meta - semEla) / P[id]), maximo: semEla + 10 * P[id] };
    });

    const melhor = opcoes
      .filter((o) => o.precisa <= 10 + 1e-9)
      .sort((a, b) => a.precisa - b.precisa)[0];

    const resultado = {
      nota: Number.isNaN(nota) ? null : nota,
      invalida: Number.isNaN(nota),
      necessaria: melhor ? Math.ceil(melhor.precisa * 100) / 100 : null,
      alvoNecessaria: melhor?.id ?? null,
      maximo: Math.max(media, ...opcoes.map((o) => o.maximo)),
      final: media,
      usada: null,
    };

    if (resultado.nota !== null) {
      alvos.forEach((id) => {
        const final = media + Math.max(0, resultado.nota - notas[id]) * P[id];
        if (final > resultado.final + 1e-9) {
          resultado.final = final;
          resultado.usada = id;
        }
      });
    }

    return resultado;
  }

  /** Calcula média, status e dados do simulador de uma matéria. */
  function avaliar(materia, meta) {
    const P = estado.pesos;
    const notas = {};
    const invalidas = [];

    IDS.forEach((id) => {
      const n = interpretarNota(materia[id]);
      if (Number.isNaN(n)) {
        invalidas.push(id);
        notas[id] = null;
      } else {
        notas[id] = n;
      }
    });

    const media = IDS.reduce((t, id) => t + (notas[id] ?? 0) * P[id], 0);
    const preenchidas = IDS.filter((id) => notas[id] !== null).length;
    const r = { notas, invalidas, media, preenchidas, estado: "", grupo: "vazia", texto: "Preencha as notas", aviso: "", sim: null };

    if (invalidas.length) {
      return { ...r, estado: "bad", grupo: "andamento", texto: "Use notas de 0 a 10" };
    }

    if (preenchidas === IDS.length) {
      const aprovado = media >= meta - 1e-9;
      const as = avaliarAS(materia, notas, media, meta);
      const base = { ...r, completa: true, as, aprovadoSemAS: aprovado };

      if (aprovado) {
        return { ...base, estado: "ok", grupo: "ok", texto: "Aprovado por nota" };
      }

      // Abaixo da média: entra a AS.
      if (as.invalida) {
        return { ...base, estado: "bad", grupo: "bad", texto: "AS: use nota de 0 a 10" };
      }

      if (as.nota !== null) {
        const passou = as.final >= meta - 1e-9;
        return {
          ...base,
          media: as.final,
          estado: passou ? "ok" : "bad",
          grupo: passou ? "ok" : "bad",
          texto: passou ? "Aprovado com AS" : "Reprovado após AS",
        };
      }

      if (as.necessaria === null) {
        return {
          ...base,
          estado: "bad",
          grupo: "bad",
          texto: "Nem com AS",
          aviso: `Máximo com AS: ${formatar(as.maximo)}`,
        };
      }

      return {
        ...base,
        estado: "bad",
        grupo: "bad",
        texto: "Faça a AS",
        precisa: as.necessaria,
        aviso: `Precisa de ${formatar(as.necessaria)} na AS`,
      };
    }
    
    if (!preenchidas) return r;

    // Notas que ainda faltam: quanto precisa tirar (a mesma nota em todas) para chegar na meta.
    const faltam = IDS.filter((id) => notas[id] === null && P[id] > 0);
    const pesoFalta = faltam.reduce((t, id) => t + P[id], 0);
    const cenarios = { pior: media, melhor: media + 10 * pesoFalta };
    const necessaria = pesoFalta > 0 ? Math.max(0, (meta - media) / pesoFalta) : (media >= meta - 1e-9 ? 0 : Infinity);
    const soAF = faltam.length === 1 && faltam[0] === "af";
    const base = { ...r, cenarios, precisa: necessaria, sim: soAF ? { necessaria } : null };

    if (necessaria > 10) {
      return { ...base, estado: "bad", grupo: "bad", texto: "Meta fora de alcance", aviso: `Máximo: ${formatar(cenarios.melhor)}` };
    }
    if (necessaria === 0) {
      return { ...base, estado: "ok", grupo: "ok", texto: "Meta já garantida" };
    }

    const precisa = formatar(Math.ceil(necessaria * 100) / 100);
    if (soAF) {
      return { ...base, estado: "warn", grupo: "warn", texto: "Falta a AF", aviso: `Precisa de ${precisa} na AF` };
    }

    const nomes = faltam.map((id) => ROTULOS[id]);
    const quais = nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}` : nomes[0];
    return {
      ...base,
      grupo: "andamento",
      texto: "Em andamento",
      aviso: `Média ${precisa} em ${quais}`,
    };
  }

  /** Faltas: limite de 25% das aulas. Devolve null quando a matéria não tem as aulas preenchidas. */
  function avaliarFaltas(materia) {
    const aulas = Number(String(materia.aulas).trim());
    const faltas = String(materia.faltas).trim() === "" ? 0 : Number(String(materia.faltas).trim());
    const aulasOk = Number.isInteger(aulas) && aulas > 0;
    const faltasOk = Number.isInteger(faltas) && faltas >= 0;
    if (!aulasOk) return { invalidaAulas: String(materia.aulas).trim() !== "", invalidaFaltas: !faltasOk };
    if (!faltasOk) return { invalidaFaltas: true };
    const limite = Math.floor(aulas * (1 - FREQUENCIA_MINIMA));
    return { faltas, aulas, limite, restam: limite - faltas, estourou: faltas > limite };
  }

  /** Avaliação completa: notas + faltas (reprovar por falta vence tudo). */
  function avaliarMateria(materia, meta) {
    const r = avaliar(materia, meta);
    const f = avaliarFaltas(materia);
    if (f.estourou) {
      return { ...r, faltas: f, estado: "bad", grupo: "bad", texto: "Reprovado por falta", aviso: `${f.faltas} faltas · limite ${f.limite}`, sim: null };
    }
    return { ...r, faltas: f };
  }

  // ---------- Cards ----------

  const lista = $("subjects");

  const iconeX = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

  function htmlCard(materia, indice) {
    const id = materia.id;
    return `
      <article class="card" data-id="${id}" aria-label="${escaparHTML(nomeDe(materia, indice))}">
        <div class="head">
          <input
            class="name"
            type="text"
            maxlength="50"
            data-field="name"
            aria-label="Nome da matéria ${indice + 1}"
            placeholder="Matéria ${indice + 1}"
            value="${escaparHTML(materia.name)}"
          >
          <span class="avg"><span data-out="avg">0,00</span><small>/10</small></span>
          <button type="button" class="icon-btn remove" data-action="remove" aria-label="Remover matéria" title="Remover matéria">${iconeX}</button>
        </div>

        <div class="bar" aria-hidden="true">
          <b data-out="ghost"></b><span data-out="bar"></span><i></i>
        </div>

        <div class="grades">
          ${IDS.map((campo) => `
            <div class="grade">
              <label for="${campo}-${id}">
                ${ROTULOS[campo]}
                <small data-peso="${campo}">${formatarPorcentagem(estado.pesos[campo])}%</small>
              </label>
              <input
                type="text"
                inputmode="decimal"
                id="${campo}-${id}"
                data-field="${campo}"
                placeholder="—"
                autocomplete="off"
                value="${escaparHTML(materia[campo])}"
              >
            </div>
          `).join("")}
        </div>

        <p class="cenarios" data-out="cenarios" hidden></p>

        <div class="faltas">
          <label for="faltas-${id}">Faltas</label>
          <input type="text" inputmode="numeric" id="faltas-${id}" data-field="faltas" placeholder="0" autocomplete="off" value="${escaparHTML(materia.faltas)}">
          <span aria-hidden="true">de</span>
          <input type="text" inputmode="numeric" data-field="aulas" placeholder="aulas" aria-label="Total de aulas da matéria" autocomplete="off" value="${escaparHTML(materia.aulas)}">
          <span class="faltas-info" data-out="faltas"></span>
        </div>

        <div class="sim" data-out="sim" hidden>
          <div class="sim-head">
            <label for="sim-${id}">Simular AF</label>
            <output data-out="sim-valor" for="sim-${id}">0,0</output>
          </div>
          <input type="range" id="sim-${id}" data-field="sim" min="0" max="10" step="0.1" value="0">
          <p class="sim-result" data-out="sim-result"></p>
        </div>

        <div class="as-box" data-out="as" hidden>
          <div class="as-head">
            <label class="as-titulo" for="as-${id}">Substitutiva <small>AS</small></label>
            <select data-field="asAlvo" aria-label="Nota que a AS substitui">
              <option value="auto">No lugar da que mais ajuda</option>
              ${IDS.map((campo) => `<option value="${campo}">No lugar da ${ROTULOS[campo]}</option>`).join("")}
            </select>
          </div>
          <div class="as-row">
            <input
              type="text"
              inputmode="decimal"
              id="as-${id}"
              data-field="as"
              placeholder="—"
              autocomplete="off"
              value="${escaparHTML(materia.as)}"
            >
            <p class="as-result" data-out="as-result"></p>
          </div>
        </div>

        <div class="cardfoot">
          <span class="status" data-out="status">Preencha as notas</span>
          <span class="note" data-out="aviso"></span>
        </div>
      </article>
    `;
  }

  function htmlAdicionar() {
    const cheio = estado.materias.length >= MAX_MATERIAS;
    return `
      <button type="button" class="add-card" data-action="add" ${cheio ? "hidden" : ""}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        Adicionar matéria
        <small>${estado.materias.length} de ${MAX_MATERIAS}</small>
      </button>
    `;
  }

  function renderizar() {
    lista.innerHTML = estado.materias.map(htmlCard).join("") + htmlAdicionar();
    atualizar();
  }

  const cardDe = (materia) => lista.querySelector(`.card[data-id="${materia.id}"]`);
  const materiaDe = (el) => {
    const card = el.closest(".card");
    return card ? estado.materias.find((m) => m.id === Number(card.dataset.id)) : null;
  };

  // ---------- Atualização da tela ----------

  function atualizar() {
    const { meta, invalida } = lerMeta();
    $("meta").classList.toggle("invalid", invalida);
    raiz.style.setProperty("--meta", `${meta * 10}%`);

    const resultados = estado.materias.map((materia, indice) => {
      const r = avaliarMateria(materia, meta);
      const card = cardDe(materia);
      if (!card) return r;

      const out = (nome) => card.querySelector(`[data-out="${nome}"]`);

      // Comemora quando a matéria passa para "aprovado" por causa de uma nota digitada agora.
      const antes = estadosAnteriores.get(materia.id);
      if (animarAprovacao && antes !== undefined && antes !== "ok" && r.estado === "ok") comemorar(card);
      estadosAnteriores.set(materia.id, r.estado);

      card.dataset.state = r.estado;
      card.dataset.grupo = r.grupo;

      // Cenários: o pior (zera o que falta) e o melhor (tira 10 em tudo que falta).
      const cen = out("cenarios");
      cen.hidden = !r.cenarios || r.grupo === "ok";
      if (!cen.hidden) {
        cen.innerHTML =
          `Zerando o que falta: <strong>${formatar(r.cenarios.pior)}</strong> · Com 10 em tudo: <strong>${formatar(r.cenarios.melhor)}</strong>`;
      }

      // Faltas
      const f = r.faltas;
      card.querySelector('[data-field="faltas"]').classList.toggle("invalid", Boolean(f.invalidaFaltas));
      card.querySelector('[data-field="aulas"]').classList.toggle("invalid", Boolean(f.invalidaAulas));
      const info = out("faltas");
      info.dataset.nivel = f.limite === undefined ? "" : f.estourou ? "bad" : f.restam <= Math.max(1, Math.floor(f.limite / 4)) ? "warn" : "ok";
      info.textContent = f.limite === undefined
        ? ""
        : f.estourou
          ? `passou ${f.faltas - f.limite} do limite`
          : f.restam === 0
            ? "no limite, nenhuma a mais"
            : `pode faltar mais ${f.restam}`;
      card.setAttribute("aria-label", nomeDe(materia, indice));
      out("avg").textContent = formatar(r.media);
      out("bar").style.width = `${r.media * 10}%`;
      out("status").textContent = r.texto;
      out("aviso").textContent = r.aviso;

      IDS.forEach((campo) => {
        card.querySelector(`[data-field="${campo}"]`).classList.toggle("invalid", r.invalidas.includes(campo));
      });

      card.querySelector(".remove").disabled = estado.materias.length <= MIN_MATERIAS;

      // Simulador da AF
      const sim = out("sim");
      if (r.sim) {
        if (materia.sim === null) {
          // Começa na nota necessária (arredondada para cima), dentro de 0–10.
          materia.sim = Math.min(10, Math.ceil(r.sim.necessaria * 10) / 10);
        }
        const valor = materia.sim;
        const final = r.media + valor * estado.pesos.af;
        const passa = final >= meta - 1e-9;

        sim.hidden = false;
        sim.dataset.passa = passa ? "sim" : "nao";
        const range = card.querySelector('[data-field="sim"]');
        range.value = valor;
        range.style.setProperty("--pos", `${valor * 10}%`);
        out("sim-valor").textContent = formatar1(valor);
        out("sim-result").innerHTML =
          `Média final <strong>${formatar(final)}</strong> · ${passa ? "aprovado ✓" : "abaixo da média"}`;
        out("ghost").style.width = `${final * 10}%`;
        r.simFinal = final;
      } else {
        materia.sim = null;
        sim.hidden = true;
        out("ghost").style.width = "0";
      }

      // Avaliação Substitutiva: aparece quando a matéria fecha abaixo da média.
      const caixaAS = out("as");
      const temAS = String(materia.as).trim() !== "";
      const mostrarAS = Boolean(r.as) && (!r.aprovadoSemAS || temAS);
      caixaAS.hidden = !mostrarAS;

      if (mostrarAS) {
        const a = r.as;
        card.querySelector('[data-field="asAlvo"]').value = materia.asAlvo;
        card.querySelector('[data-field="as"]').classList.toggle("invalid", a.invalida);
        caixaAS.dataset.passa = r.texto === "Aprovado com AS" ? "sim" : "nao";

        let texto;
        if (r.aprovadoSemAS) {
          texto = "Você já passou sem a AS.";
        } else if (a.invalida) {
          texto = "Use uma nota de 0 a 10.";
        } else if (a.nota !== null) {
          texto = a.usada
            ? `Média com AS <strong>${formatar(a.final)}</strong> · no lugar da ${ROTULOS[a.usada]}`
            : "A AS não supera a nota substituída.";
        } else if (a.necessaria !== null) {
          texto = `Tire <strong>${formatar(a.necessaria)}</strong> para passar · no lugar da ${ROTULOS[a.alvoNecessaria]}`;
        } else {
          texto = `Mesmo com 10, a média chega a <strong>${formatar(a.maximo)}</strong>.`;
        }
        out("as-result").innerHTML = texto;
      }

      return r;
    });

    atualizarResumo(resultados);
    ultimosResultados = resultados;
    // Reordenar enquanto alguém digita faria o card "fugir"; espera sair do card.
    if (!lista.contains(document.activeElement)) organizar();
    return resultados;
  }

  // ---------- Ordem de prioridade e modo foco ----------

  const estadosAnteriores = new Map();
  let animarAprovacao = false;
  let ultimosResultados = [];

  const CHAVE_PREFS = "calc-media-facens-prefs";
  const prefs = (() => {
    try {
      return { ordem: "minha", foco: false, ...JSON.parse(localStorage.getItem(CHAVE_PREFS) || "{}") };
    } catch {
      return { ordem: "minha", foco: false };
    }
  })();
  const salvarPrefs = () => {
    try { localStorage.setItem(CHAVE_PREFS, JSON.stringify(prefs)); } catch { /* sem armazenamento */ }
  };

  // Quanto menor, mais acima: em risco, depende da AF, em andamento, vazia, aprovada.
  const PESO_GRUPO = { bad: 0, warn: 1, andamento: 2, vazia: 3, ok: 4 };

  function organizar() {
    const cards = estado.materias.map((m, i) => ({ m, r: ultimosResultados[i], card: cardDe(m), i }));
    const ordenados = [...cards].sort((a, b) =>
      (PESO_GRUPO[a.r?.grupo] ?? 3) - (PESO_GRUPO[b.r?.grupo] ?? 3) ||
      (b.r?.precisa ?? 0) - (a.r?.precisa ?? 0) ||
      a.i - b.i);

    ordenados.forEach(({ card }, posicao) => {
      if (card) card.style.order = prefs.ordem === "prioridade" ? String(posicao) : "";
    });

    let visiveis = 0;
    cards.forEach(({ card, r }) => {
      if (!card) return;
      const esconder = prefs.foco && (r?.grupo === "ok" || r?.grupo === "vazia");
      card.hidden = esconder;
      if (!esconder) visiveis++;
    });
    $("foco-vazio").hidden = !(prefs.foco && visiveis === 0);

    document.querySelectorAll("[data-ordem]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.ordem === prefs.ordem)));
    $("foco").setAttribute("aria-pressed", String(prefs.foco));
  }

  document.querySelectorAll("[data-ordem]").forEach((b) => b.addEventListener("click", () => {
    prefs.ordem = b.dataset.ordem;
    salvarPrefs();
    organizar();
  }));

  $("foco").addEventListener("click", () => {
    prefs.foco = !prefs.foco;
    salvarPrefs();
    organizar();
  });

  // Saiu de um card: agora pode reorganizar.
  lista.addEventListener("focusout", () => {
    setTimeout(() => { if (!lista.contains(document.activeElement)) organizar(); }, 0);
  });

  // ---------- Comemoração ao aprovar ----------

  const CORES_CONFETE = ["#22a45d", "#0057a3", "#00a9d6", "#e0961a", "#7ee8a5"];

  function comemorar(card) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    navigator.vibrate?.(18);
    const camada = document.createElement("div");
    camada.className = "confete";
    camada.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 18; i++) {
      const p = document.createElement("i");
      const angulo = (Math.PI * 2 * i) / 18 + Math.random() * 0.4;
      const distancia = 60 + Math.random() * 70;
      p.style.setProperty("--x", `${Math.cos(angulo) * distancia}px`);
      p.style.setProperty("--y", `${Math.sin(angulo) * distancia - 30}px`);
      p.style.setProperty("--r", `${Math.round(Math.random() * 540 - 270)}deg`);
      p.style.background = CORES_CONFETE[i % CORES_CONFETE.length];
      camada.append(p);
    }
    card.append(camada);
    setTimeout(() => camada.remove(), 1000);
  }

  // ---------- Atalhos de teclado ----------

  const CAMPOS_NOTA = new Set([...IDS, "as"]);

  /** Campos de texto na ordem em que aparecem na tela (respeita a ordem de prioridade). */
  function camposEmOrdem() {
    return [...lista.querySelectorAll(".card:not([hidden])")]
      .map((card, i) => ({ card, i, ordem: Number(card.style.order || 0) }))
      .sort((a, b) => a.ordem - b.ordem || a.i - b.i)
      .flatMap(({ card }) => [...card.querySelectorAll('input[type="text"]')].filter((el) => el.offsetParent !== null));
  }

  lista.addEventListener("keydown", (e) => {
    const campo = e.target.dataset?.field;
    if (!campo || e.target.type !== "text") return;

    if (e.key === "Enter") {
      e.preventDefault();
      const campos = camposEmOrdem();
      const proximo = campos[campos.indexOf(e.target) + (e.shiftKey ? -1 : 1)];
      proximo?.focus();
      proximo?.select();
      return;
    }

    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && (CAMPOS_NOTA.has(campo) || campo === "faltas" || campo === "aulas")) {
      e.preventDefault();
      const ehNota = CAMPOS_NOTA.has(campo);
      const passo = (ehNota ? 0.5 : 1) * (e.key === "ArrowUp" ? 1 : -1);
      const atual = Number(e.target.value.trim().replace(",", ".")) || 0;
      let novo = Math.max(0, atual + passo);
      if (ehNota) novo = Math.min(10, Math.round(novo * 2) / 2);
      e.target.value = ehNota ? (Number.isInteger(novo) ? String(novo) : formatar1(novo)) : String(Math.round(novo));
      e.target.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  // ---------- Resumo do semestre ----------

  const ROTULOS_RESUMO = {
    ok: ["aprovada", "aprovadas"],
    warn: ["depende da AF", "dependem da AF"],
    bad: ["em risco", "em risco"],
    andamento: ["em andamento", "em andamento"],
  };

  function atualizarResumo(resultados) {
    const conta = { ok: 0, warn: 0, bad: 0, andamento: 0 };
    resultados.forEach((r) => {
      if (r.grupo in conta) conta[r.grupo]++;
    });

    Object.entries(conta).forEach(([grupo, n]) => {
      const item = document.querySelector(`[data-resumo="${grupo}"]`);
      item.querySelector("b").textContent = n;
      item.querySelector("span").textContent = ROTULOS_RESUMO[grupo][n === 1 ? 0 : 1];
      item.classList.toggle("zero", n === 0);
    });

    const completas = resultados.filter((r) => r.completa);
    const geral = $("media-geral");
    const detalhe = $("media-geral-detalhe");

    if (completas.length) {
      const media = completas.reduce((t, r) => t + r.media, 0) / completas.length;
      geral.textContent = formatar(media);
      detalhe.textContent = `${completas.length} de ${resultados.length} ${resultados.length === 1 ? "matéria completa" : "matérias completas"}`;
    } else {
      geral.textContent = "—";
      detalhe.textContent = "Complete as 4 notas de uma matéria";
    }
  }

  // ---------- Eventos dos cards ----------

  lista.addEventListener("input", (e) => {
    const campo = e.target.dataset.field;
    const materia = materiaDe(e.target);
    if (!campo || !materia) return;

    if (campo === "sim") {
      materia.sim = Number(e.target.value);
    } else {
      materia[campo] = e.target.value;
      salvar();
    }
    animarAprovacao = campo !== "sim" && campo !== "name";
    atualizar();
    animarAprovacao = false;
  });

  lista.addEventListener("click", (e) => {
    const botao = e.target.closest("[data-action]");
    if (!botao) return;

    if (botao.dataset.action === "add") {
      if (estado.materias.length >= MAX_MATERIAS) return;
      const nova = novaMateria();
      estado.materias.push(nova);
      salvar();
      renderizar();
      const nome = cardDe(nova).querySelector(".name");
      nome.focus();
      cardDe(nova).scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }

    if (botao.dataset.action === "remove") {
      removerMateria(materiaDe(botao));
    }
  });

  async function removerMateria(materia) {
    if (!materia || estado.materias.length <= MIN_MATERIAS) return;
    const indice = estado.materias.indexOf(materia);
    const temNotas = [...IDS, "as"].some((id) => String(materia[id]).trim() !== "");

    if (temNotas) {
      const ok = await confirmar({
        titulo: `Remover "${nomeDe(materia, indice)}"?`,
        texto: "A matéria e todas as notas dela serão apagadas. Não dá para desfazer.",
        acao: "Remover",
        icone: "lixeira",
      });
      if (!ok) return;
    }

    const card = cardDe(materia);
    card?.classList.add("saindo");
    await new Promise((r) => setTimeout(r, card ? 180 : 0));

    estado.materias.splice(estado.materias.indexOf(materia), 1);
    salvar();
    renderizar();
  }

  // ---------- Pop-up de confirmação ----------

  const ICONES = {
    lixeira: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    apagar: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    importar: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  };

  /** Pop-up de confirmação no estilo do site. Resolve true se o usuário confirmar. */
  function confirmar({ titulo, texto, acao = "Confirmar", icone = "lixeira", perigo = true }) {
    const d = $("confirm-dialog");
    $("confirm-titulo").textContent = titulo;
    $("confirm-texto").textContent = texto;
    $("confirm-ok").textContent = acao;
    $("confirm-ok").className = perigo ? "danger" : "primary";
    d.dataset.tom = perigo ? "perigo" : "normal";
    $("confirm-icone").innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[icone] || ICONES.lixeira}</svg>`;

    d.returnValue = "";
    d.showModal();
    $("confirm-cancelar").focus();

    return new Promise((resolve) => {
      d.addEventListener("close", () => resolve(d.returnValue === "ok"), { once: true });
    });
  }

  $("confirm-cancelar").addEventListener("click", () => $("confirm-dialog").close("cancelar"));
  $("confirm-ok").addEventListener("click", () => $("confirm-dialog").close("ok"));

  // ---------- Barra superior ----------

  $("meta").addEventListener("input", (e) => {
    estado.meta = e.target.value;
    salvar();
    atualizar();
  });

  const algumaNota = () =>
    estado.materias.some((m) => [...IDS, "as"].some((id) => String(m[id]).trim() !== ""));

  $("clear").addEventListener("click", async () => {
    if (algumaNota()) {
      const ok = await confirmar({
        titulo: "Limpar todas as notas?",
        texto: "As notas de todas as matérias serão apagadas. Os nomes das matérias continuam.",
        acao: "Limpar notas",
        icone: "apagar",
      });
      if (!ok) return;
    }
    estado.materias.forEach((m) => {
      IDS.forEach((id) => { m[id] = ""; });
      m.as = "";
      m.faltas = "";
      m.sim = null;
    });
    salvar();
    renderizar();
    lista.querySelector('[data-field="ac1"]')?.focus();
  });

  // ---------- Pop-up de pesos ----------

  function mostrarPesos() {
    document.querySelectorAll("[data-peso]").forEach((el) => {
      el.textContent = `${formatarPorcentagem(estado.pesos[el.dataset.peso])}%`;
    });
    $("pesos-texto").textContent = IDS.map(
      (id) => `${ROTULOS[id]} ${formatarPorcentagem(estado.pesos[id])}%`,
    ).join(" · ");
  }

  const dialogoPesos = $("pesos-dialog");

  $("pesos-campos").innerHTML = IDS.map((id) => `
    <div class="peso-campo">
      <label for="peso-${id}">${ROTULOS[id]}</label>
      <input type="text" inputmode="decimal" id="peso-${id}" autocomplete="off">
      <span aria-hidden="true">%</span>
    </div>
  `).join("");

  const camposPeso = IDS.map((id) => $(`peso-${id}`));

  function validarPesos() {
    const valores = camposPeso.map((campo) => {
      const texto = campo.value.trim().replace(",", ".");
      const n = texto === "" ? NaN : Number(texto);
      const ok = Number.isFinite(n) && n >= 0 && n <= 100;
      campo.classList.toggle("invalid", !ok);
      return ok ? n : NaN;
    });

    const algumInvalido = valores.some(Number.isNaN);
    const soma = valores.reduce((t, v) => t + (Number.isNaN(v) ? 0 : v), 0);
    const somaCerta = Math.abs(soma - 100) < 0.01;
    const total = $("pesos-total");

    total.classList.toggle("erro", algumInvalido || !somaCerta);
    total.textContent = algumInvalido
      ? "Use valores de 0 a 100"
      : somaCerta
        ? "Total: 100%"
        : `Total: ${formatarPorcentagem(soma / 100)}% · precisa dar 100%`;

    $("pesos-salvar").disabled = algumInvalido || !somaCerta;
    return !algumInvalido && somaCerta ? valores : null;
  }

  function preencherPesos(pesos) {
    IDS.forEach((id, i) => { camposPeso[i].value = formatarPorcentagem(pesos[id]); });
    validarPesos();
  }

  // Link do arquivo da Facens: enquanto o href for "#", aparece como "Link em breve".
  const linkFacens = $("link-facens");
  const href = linkFacens.getAttribute("href") || "";
  if (href === "" || href === "#") {
    linkFacens.setAttribute("aria-disabled", "true");
    linkFacens.addEventListener("click", (e) => e.preventDefault());
  } else {
    $("link-facens-aviso").textContent = "";
  }

  $("open-pesos").addEventListener("click", () => {
    preencherPesos(estado.pesos);
    dialogoPesos.showModal();
  });
  camposPeso.forEach((c) => c.addEventListener("input", validarPesos));
  $("pesos-padrao").addEventListener("click", () => preencherPesos(PESOS_PADRAO));
  ["pesos-cancelar", "pesos-fechar"].forEach((id) =>
    $(id).addEventListener("click", () => dialogoPesos.close()));

  $("pesos-form").addEventListener("submit", (e) => {
    const valores = validarPesos();
    if (!valores) {
      e.preventDefault();
      return;
    }
    IDS.forEach((id, i) => { estado.pesos[id] = valores[i] / 100; });
    estado.materias.forEach((m) => { m.sim = null; });
    mostrarPesos();
    salvar();
    atualizar();
  });

  // Fechar qualquer pop-up clicando fora da caixa.
  document.querySelectorAll("dialog").forEach((d) => {
    d.addEventListener("click", (e) => {
      if (e.target === d) d.close();
    });
  });

  // ---------- Compartilhar: link ----------

  function codificar(dados) {
    const bytes = new TextEncoder().encode(JSON.stringify(dados));
    let bin = "";
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodificar(texto) {
    const base = texto.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(base + "===".slice((base.length + 3) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function gerarLink() {
    const d = exportarDados();
    const compacto = {
      s: d.subjects.map((m) => [m.name, m.ac1, m.ac2, m.ag, m.af, m.as, m.asAlvo, m.faltas, m.aulas]),
      m: d.meta,
      p: IDS.map((id) => d.pesos[id]),
    };
    const url = new URL(location.href);
    url.hash = `d=${codificar(compacto)}`;
    return url.toString();
  }

  function lerLink() {
    const match = location.hash.match(/^#d=([\w-]+)$/);
    if (!match) return null;
    try {
      const c = decodificar(match[1]);
      if (!Array.isArray(c.s)) return null;
      return {
        subjects: c.s.map((linha) => {
          const [name, ac1, ac2, ag, af, as, asAlvo, faltas, aulas] = linha.map((v) => String(v ?? "").slice(0, 50));
          return { name, ac1, ac2, ag, af, as, asAlvo, faltas, aulas };
        }),
        meta: String(c.m ?? "6,0").slice(0, 6),
        pesos: Array.isArray(c.p) ? Object.fromEntries(IDS.map((id, i) => [id, Number(c.p[i])])) : null,
      };
    } catch {
      return null;
    }
  }

  // ---------- Compartilhar: imagem estilo "stories" (1080×1920) ----------

  const logo = document.querySelector(".top .brand");

  // Paletas da imagem: [cor de cima, cor de baixo, cor de destaque]
  const PALETAS = {
    oceano: ["#0057a3", "#00b4d8", "#d8f6ff"],
    vibe: ["#7b2ff7", "#f107a3", "#ffe0f4"],
    sunset: ["#ff512f", "#f09819", "#fff1d6"],
    menta: ["#0f9b6c", "#7ee8a5", "#e3ffef"],
    noite: ["#0f1020", "#3a3d6b", "#c9ccff"],
  };
  let paletaAtual = "oceano";

  function retangulo(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function cortarTexto(ctx, texto, largura) {
    let t = texto;
    while (ctx.measureText(t).width > largura && t.length > 2) t = `${t.slice(0, -2)}…`;
    return t;
  }

  function gerarImagem(resultados) {
    const W = 1080;
    const H = 1920;
    const PAD = 80;
    const [c1, c2, destaque] = PALETAS[paletaAtual];
    const sans = '"Geist", "Segoe UI", system-ui, sans-serif';
    const mono = '"Geist Mono", Consolas, monospace';
    const branco = "#ffffff";
    const suave = "rgba(255,255,255,0.72)";

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    // Fundo em degradê + brilhos
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    [[W * 0.95, 180, 520, 0.22], [W * 0.05, H * 0.62, 600, 0.14]].forEach(([x, y, r, a]) => {
      const brilho = ctx.createRadialGradient(x, y, 0, x, y, r);
      brilho.addColorStop(0, `rgba(255,255,255,${a})`);
      brilho.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = brilho;
      ctx.fillRect(0, 0, W, H);
    });

    // Logo (branco)
    if (logo?.complete && logo.naturalWidth) {
      const lw = 190;
      const lh = (logo.naturalHeight / logo.naturalWidth) * lw;
      ctx.save();
      ctx.filter = "brightness(0) invert(1)";
      ctx.drawImage(logo, PAD, 96, lw, lh);
      ctx.restore();
    }

    const ano = new Date().getFullYear();
    const semestre = new Date().getMonth() < 6 ? 1 : 2;
    ctx.textAlign = "right";
    ctx.fillStyle = suave;
    ctx.font = `600 30px ${sans}`;
    ctx.fillText(`${ano}.${semestre}`, W - PAD, 130);
    ctx.textAlign = "left";

    // Título
    ctx.fillStyle = destaque;
    ctx.font = `700 34px ${sans}`;
    ctx.fillText("MEU SEMESTRE", PAD, 270);
    ctx.fillStyle = branco;
    ctx.font = `800 112px ${sans}`;
    ctx.fillText("Minhas", PAD, 390);
    ctx.fillText("médias", PAD, 500);

    // Média geral
    const completas = resultados.filter((r) => r.completa);
    const geral = completas.length
      ? completas.reduce((t, r) => t + r.media, 0) / completas.length
      : null;

    ctx.fillStyle = "rgba(0,0,0,0.18)";
    retangulo(ctx, PAD, 560, W - PAD * 2, 210, 36);
    ctx.fill();

    ctx.fillStyle = suave;
    ctx.font = `600 28px ${sans}`;
    ctx.fillText("Média geral", PAD + 44, 624);
    ctx.fillStyle = branco;
    ctx.font = `700 120px ${mono}`;
    ctx.fillText(geral === null ? "—" : formatar(geral), PAD + 36, 736);

    const conta = { ok: 0, warn: 0, bad: 0 };
    resultados.forEach((r) => { if (r.grupo in conta) conta[r.grupo]++; });
    const chips = [
      [conta.ok, conta.ok === 1 ? "aprovada" : "aprovadas"],
      [conta.warn, conta.warn === 1 ? "depende da AF" : "dependem da AF"],
      [conta.bad, "em risco"],
    ].filter(([n]) => n > 0);

    ctx.textAlign = "right";
    ctx.font = `600 28px ${sans}`;
    chips.forEach(([n, rotulo], i) => {
      ctx.fillStyle = i === 0 ? branco : suave;
      ctx.fillText(`${n} ${rotulo}`, W - PAD - 44, 640 + i * 44);
    });
    ctx.textAlign = "left";

    // Lista de matérias
    // Só entram matérias com alguma nota (se nenhuma tiver, mostra todas).
    const comNota = (m) => [...IDS, "as"].some((id) => String(m[id]).trim() !== "");
    let itens = resultados.map((r, i) => ({ r, m: estado.materias[i], i }));
    if (itens.some(({ m }) => comNota(m))) itens = itens.filter(({ m }) => comNota(m));

    const topo = 830;
    const rodape = 150;
    const n = itens.length;
    const espaco = H - topo - rodape;
    const linha = Math.min(150, espaco / n);
    const esc = Math.max(0.62, linha / 150); // escala das fontes quando há muitas matérias

    itens.forEach(({ r, m, i: original }, i) => {
      const y = topo + i * linha;
      const h = linha - 14 * esc;

      ctx.fillStyle = i % 2 ? "rgba(0,0,0,0.10)" : "rgba(0,0,0,0.16)";
      retangulo(ctx, PAD, y, W - PAD * 2, h, 26 * esc);
      ctx.fill();

      const meio = y + h / 2;

      // Posição
      ctx.fillStyle = destaque;
      ctx.font = `700 ${40 * esc}px ${mono}`;
      ctx.fillText(String(i + 1).padStart(2, "0"), PAD + 30, meio + 14 * esc);

      // Nome
      const xNome = PAD + 30 + 78 * esc;
      ctx.fillStyle = branco;
      ctx.font = `700 ${36 * esc}px ${sans}`;
      ctx.fillText(cortarTexto(ctx, nomeDe(m, original), 560 - 60 * (1 - esc)), xNome, meio - 6 * esc);

      // Notas
      const partes = IDS.map((id) => {
        const v = interpretarNota(m[id]);
        return `${ROTULOS[id]} ${v === null || Number.isNaN(v) ? "—" : formatar1(v)}`;
      });
      const as = interpretarNota(m.as);
      if (as !== null && !Number.isNaN(as)) partes.push(`AS ${formatar1(as)}`);
      ctx.fillStyle = suave;
      ctx.font = `500 ${24 * esc}px ${mono}`;
      ctx.fillText(cortarTexto(ctx, partes.join("  "), 640), xNome, meio + 34 * esc);

      // Média + selo
      ctx.textAlign = "right";
      ctx.fillStyle = branco;
      ctx.font = `700 ${58 * esc}px ${mono}`;
      ctx.fillText(formatar(r.media), W - PAD - 30, meio + 12 * esc);

      const selo = { ok: "#7CFFB2", bad: "#FFB4B4", warn: "#FFE08A" }[r.estado];
      if (selo) {
        ctx.fillStyle = selo;
        ctx.beginPath();
        ctx.arc(W - PAD - 30 - ctx.measureText(formatar(r.media)).width - 22 * esc, meio - 6 * esc, 9 * esc, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.textAlign = "left";
    });

    // Rodapé
    ctx.fillStyle = suave;
    ctx.font = `500 26px ${sans}`;
    ctx.fillText("Calculadora de média · ferramenta não oficial", PAD, H - 80);
    const { meta } = lerMeta();
    ctx.textAlign = "right";
    ctx.fillText(`Média mínima ${formatar1(meta)}`, W - PAD, H - 80);
    ctx.textAlign = "left";

    return canvas;
  }

  // ---------- Pop-up de compartilhar ----------

  const dialogoShare = $("share-dialog");
  let imagemAtual = null;

  async function atualizarPreview() {
    await document.fonts.ready;
    const canvas = gerarImagem(atualizar());
    imagemAtual = await new Promise((ok) => canvas.toBlob(ok, "image/png"));
    const preview = $("share-preview");
    if (preview.src.startsWith("blob:")) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(imagemAtual);
  }

  $("share-paletas").innerHTML = Object.entries(PALETAS).map(([nome, [a, b]]) => `
    <button type="button" class="paleta" data-paleta="${nome}" aria-label="Cor ${nome}"
      style="background: linear-gradient(135deg, ${a}, ${b})"></button>
  `).join("");

  $("share-paletas").addEventListener("click", (e) => {
    const botao = e.target.closest("[data-paleta]");
    if (!botao) return;
    paletaAtual = botao.dataset.paleta;
    document.querySelectorAll(".paleta").forEach((p) =>
      p.setAttribute("aria-pressed", String(p === botao)));
    atualizarPreview();
  });

  $("share").addEventListener("click", async () => {
    document.querySelectorAll(".paleta").forEach((p) =>
      p.setAttribute("aria-pressed", String(p.dataset.paleta === paletaAtual)));
    await atualizarPreview();

    $("share-link").value = gerarLink();
    $("share-copiar").textContent = "Copiar link";

    const arquivo = new File([imagemAtual], "minhas-medias.png", { type: "image/png" });
    $("share-nativo").hidden = !(navigator.canShare && navigator.canShare({ files: [arquivo] }));

    dialogoShare.showModal();
  });

  $("share-fechar").addEventListener("click", () => dialogoShare.close());

  $("share-baixar").addEventListener("click", () => {
    if (!imagemAtual) return;
    const a = document.createElement("a");
    a.href = $("share-preview").src;
    a.download = "minhas-medias.png";
    a.click();
  });

  $("share-copiar").addEventListener("click", async () => {
    const campo = $("share-link");
    try {
      await navigator.clipboard.writeText(campo.value);
    } catch {
      campo.select();
      document.execCommand("copy");
    }
    $("share-copiar").textContent = "Copiado ✓";
  });

  $("share-nativo").addEventListener("click", async () => {
    const arquivo = new File([imagemAtual], "minhas-medias.png", { type: "image/png" });
    try {
      await navigator.share({ files: [arquivo], title: "Minhas médias" });
    } catch {
      // Usuário cancelou.
    }
  });

  // ---------- Importar notas de um print (OCR no próprio navegador) ----------

  const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  const dialogoImport = $("import-dialog");
  let importadas = [];

  function carregarTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    return new Promise((ok, falha) => {
      const s = document.createElement("script");
      s.src = TESSERACT_URL;
      s.onload = () => ok(window.Tesseract);
      s.onerror = () => falha(new Error("Não foi possível carregar o leitor de imagem."));
      document.head.append(s);
    });
  }

  // Números como o OCR costuma ler: "7,5", "7.5", "80" (= 8,0), "100" (= 10,0)
  const RE_NOTA = /(?<![\d,.])(\d{1,3}(?:[.,]\d{1,2})?)(?![\d])/g;
  // Rótulos como o OCR costuma ler: "AC1", "AC 1", "ACI", "AC2", "AG", "AF", "AS"
  const RE_ROTULO = /\b(A\s?C\s?[1Il|]|A\s?C\s?2|A\s?G|A\s?F|A\s?S)\b[\s:;\-'"’`.]*(\d{1,3}(?:[.,]\d{1,2})?|-|—)?/gi;

  function rotuloParaCampo(r) {
    const t = r.replace(/\s/g, "").toUpperCase().replace(/[IL|]/g, "1");
    return { AC1: "ac1", AC2: "ac2", AG: "ag", AF: "af", AS: "as" }[t] || null;
  }

  /** Corrige erros comuns do OCR: "80" → "8,0", "100" → "10,0". Devolve "" se não for nota válida. */
  function normalizarNota(valor) {
    let t = String(valor).replace(/[^\d,.]/g, "").replace(".", ",");
    if (!t) return "";
    if (!t.includes(",")) {
      if (t.length === 2 && t !== "10") t = `${t[0]},${t[1]}`;
      else if (t.length === 3 && t.startsWith("10")) t = `10,${t[2]}`;
    }
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) && n >= 0 && n <= 10 ? t : "";
  }

  const PALAVRAS_IGNORADAS =
    /^(nota|notas|m[eé]dia|frequ[eê]ncia|faltas?|situa[cç][aã]o|boletim|disciplinas?|semestre|per[ií]odo|aprovado|reprovado|cursando|total)\b/i;

  const ehNome = (linha) => {
    const t = linha.replace(RE_ROTULO, "").trim();
    const letras = (t.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    const digitos = (t.match(/\d/g) || []).length;
    // Aceita nomes curtos como "UPX", mas exige que a linha seja quase só letras.
    return letras >= 2 && digitos <= 2 && letras / t.replace(/\s/g, "").length >= 0.7 &&
      !PALAVRAS_IGNORADAS.test(t);
  };

  const limparNome = (t) =>
    t
      // Algarismos romanos lidos como "|", "!" ou "l": "Cálculo |!" → "Cálculo II"
      .replace(/(\s)([|!lI]{1,3})\s*$/, (_, espaco, r) => espaco + r.replace(/[|!l]/g, "I"))
      .replace(/[|_•·*>«»]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 50);

  /** Transforma o texto lido do print em matérias com notas. */
  function interpretarTexto(texto) {
    const linhas = texto.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const materias = [];
    let atual = null;

    const nova = (nome) => {
      atual = { name: limparNome(nome), ac1: "", ac2: "", ag: "", af: "", as: "" };
      materias.push(atual);
    };

    linhas.forEach((linha) => {
      // Caso 1: linha com rótulos ("AC1: 7,5  AC2: 8,0  AG: 9  AF: —")
      const rotulos = [...linha.matchAll(RE_ROTULO)];
      if (rotulos.length) {
        const antes = linha.slice(0, rotulos[0].index).trim();
        if (antes && ehNome(antes)) nova(antes);
        if (!atual) nova(`Matéria ${materias.length + 1}`);
        rotulos.forEach(([, rotulo, valor]) => {
          const campo = rotuloParaCampo(rotulo);
          if (campo && valor) atual[campo] = normalizarNota(valor);
        });
        return;
      }

      // Caso 2: linha de tabela ("Cálculo I   7,0  6,5  8,0  5,5")
      const numeros = [...linha.matchAll(RE_NOTA)]
        .map((n) => ({ ...n, nota: normalizarNota(n[1]) }))
        .filter((n) => n.nota !== "");
      if (numeros.length >= 2) {
        const antes = linha.slice(0, numeros[0].index).trim();
        if (antes && ehNome(antes)) nova(antes);
        else if (!atual) return;
        const vazios = IDS.filter((id) => atual[id] === "");
        numeros.slice(0, vazios.length).forEach((n, i) => {
          atual[vazios[i]] = n.nota;
        });
        return;
      }

      // Caso 3: só o nome da matéria
      if (ehNome(linha)) nova(linha);
    });

    // Fica só com o que parece matéria (tem pelo menos uma nota)
    return materias
      .filter((m) => [...IDS, "as"].some((id) => m[id] !== ""))
      .slice(0, MAX_MATERIAS);
  }

  // ----- Leitura por colunas (formato do app da Facens) -----
  // Cada matéria aparece como: nome, depois uma linha de rótulos
  // (AC1 AC2 AF Sub AG Média) e logo abaixo a linha de valores.
  // Usamos a posição horizontal de cada valor para saber a coluna dele.

  const ORDEM_APP = ["ac1", "ac2", "af", "as", "ag", null]; // null = coluna "Média" (ignorada)

  function campoDoRotulo(texto) {
    const t = texto.toUpperCase().replace(/[^A-ZÉ0-9]/g, "");
    if (!t) return undefined;
    if (/^M[EÉ]D/.test(t)) return null;
    if (/^SUB|^AS$/.test(t)) return "as";
    if (/^AF/.test(t)) return "af";
    if (/^AG/.test(t)) return "ag";
    if (/^AC2/.test(t)) return "ac2";
    if (/^AC/.test(t)) return "ac1"; // "AC1", "ACI", "AC]"...
    return undefined; // não reconhecido
  }

  const ehLinhaDeRotulos = (palavras) =>
    palavras.length >= 3 &&
    palavras.filter((p) => campoDoRotulo(p.text) !== undefined).length >= 2 &&
    !palavras.some((p) => /\d[,.]\d/.test(p.text));

  /** Valor de uma célula: "7,25", "10", "o)"/"O" (zero lido errado), "-" (vazio). */
  function valorDaCelula(texto) {
    const t = texto.trim();
    if (/^[-–—~_]+$/.test(t)) return "";
    if (/^[oO0][)\]]?$/.test(t)) return "0";
    return normalizarNota(t);
  }

  function interpretarColunas(data) {
    const linhas = (data.lines || [])
      .map((l) => ({ texto: l.text.trim(), palavras: (l.words || []).filter((w) => w.text.trim()) }))
      .filter((l) => l.texto);

    const materias = [];
    let atual = null;
    let colunas = null; // [{ campo, x }]

    const centro = (w) => (w.bbox.x0 + w.bbox.x1) / 2;

    linhas.forEach(({ texto, palavras }) => {
      if (ehLinhaDeRotulos(palavras)) {
        const ordenadas = [...palavras].sort((a, b) => centro(a) - centro(b));
        colunas = ordenadas.map((p, i) => {
          const lido = campoDoRotulo(p.text);
          // Rótulo ilegível: deduz pela ordem padrão do app.
          return { campo: lido === undefined ? ORDEM_APP[i] ?? null : lido, x: centro(p) };
        });
        return;
      }

      // Linha de valores logo depois dos rótulos
      if (colunas && atual) {
        const valores = palavras.map((p) => ({ v: valorDaCelula(p.text), bruto: p.text, x: centro(p) }));
        const pareceValores = valores.filter((v) => v.v !== "" || /^[-–—~_]+$/.test(v.bruto)).length >= Math.min(2, palavras.length);
        if (pareceValores) {
          valores.forEach(({ v, x }) => {
            const col = colunas.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
            if (col.campo && v !== "") atual[col.campo] = v;
          });
          colunas = null;
          return;
        }
      }

      if (ehNome(texto)) {
        atual = { name: limparNome(texto), ac1: "", ac2: "", ag: "", af: "", as: "" };
        materias.push(atual);
        colunas = null;
      }
    });

    return materias
      .filter((m) => [...IDS, "as"].some((id) => m[id] !== ""))
      .slice(0, MAX_MATERIAS);
  }

  // Ordem igual à do app da Facens
  const CAMPOS_IMPORT = ["ac1", "ac2", "af", "as", "ag"];
  const ROTULO_IMPORT = { ...ROTULOS, as: "Sub" };

  function mostrarRevisao() {
    const corpo = $("import-revisao");
    if (!importadas.length) {
      corpo.innerHTML = `<p class="import-vazio">Não encontrei matérias com notas nesse print. Tente um print mais nítido, só com a tela de notas.</p>`;
      $("import-aplicar").disabled = true;
      return;
    }

    corpo.innerHTML = `
      <div class="import-tabela" role="table">
        <div class="import-linha import-cab" role="row">
          <span role="columnheader">Matéria</span>
          ${CAMPOS_IMPORT.map((id) => `<span role="columnheader">${ROTULO_IMPORT[id]}</span>`).join("")}
          <span></span>
        </div>
        ${importadas.map((m, i) => `
          <div class="import-linha" role="row" data-i="${i}">
            <input type="text" data-k="name" value="${escaparHTML(m.name)}" aria-label="Nome">
            ${CAMPOS_IMPORT.map((id) => `<input type="text" inputmode="decimal" data-k="${id}" value="${escaparHTML(m[id])}" placeholder="—" aria-label="${ROTULO_IMPORT[id]}">`).join("")}
            <button type="button" class="icon-btn" data-remover="${i}" aria-label="Tirar da lista">${iconeX}</button>
          </div>
        `).join("")}
      </div>
    `;
    $("import-aplicar").disabled = false;
    $("import-aplicar").textContent = `Preencher ${importadas.length} ${importadas.length === 1 ? "matéria" : "matérias"}`;
  }

  $("import-revisao").addEventListener("input", (e) => {
    const linha = e.target.closest("[data-i]");
    if (linha && e.target.dataset.k) importadas[Number(linha.dataset.i)][e.target.dataset.k] = e.target.value;
  });

  $("import-revisao").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remover]");
    if (!b) return;
    importadas.splice(Number(b.dataset.remover), 1);
    mostrarRevisao();
  });

  function etapaImport(etapa) {
    dialogoImport.dataset.etapa = etapa;
  }

  /** Abre a imagem de um jeito que funciona em todos os navegadores (inclusive Safari do iPhone). */
  async function abrirImagem(arquivo) {
    if (window.createImageBitmap) {
      try {
        return await createImageBitmap(arquivo);
      } catch {
        // Alguns celulares não suportam; tenta pelo <img> abaixo.
      }
    }
    const url = URL.createObjectURL(arquivo);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const larguraDe = (img) => img.naturalWidth || img.width;
  const alturaDe = (img) => img.naturalHeight || img.height;

  /**
   * Prepara o print para o OCR: ajusta o tamanho (sem passar do que a memória do
   * celular aguenta), passa para tons de cinza, aumenta o contraste e, se o print
   * for do tema escuro, inverte as cores. Feito pixel a pixel porque o Safari
   * não suporta filtros no canvas.
   */
  async function prepararImagem(arquivo, maxPixels = 4_000_000) {
    const img = await abrirImagem(arquivo);
    const w = larguraDe(img);
    const h = alturaDe(img);
    let escala = Math.min(2, Math.max(1, 1400 / w));
    escala = Math.min(escala, Math.sqrt(maxPixels / (w * h)));

    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * escala));
    c.height = Math.max(1, Math.round(h * escala));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    img.close?.();

    const dados = ctx.getImageData(0, 0, c.width, c.height);
    const px = dados.data;

    let soma = 0;
    for (let i = 0; i < px.length; i += 4 * 16) soma += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const escuro = soma / (px.length / (4 * 16)) < 110;
    const contraste = escuro ? 1.6 : 1.4;

    for (let i = 0; i < px.length; i += 4) {
      let y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (escuro) y = 255 - y;
      y = (y - 128) * contraste + 128;
      y = y < 0 ? 0 : y > 255 ? 255 : y;
      px[i] = px[i + 1] = px[i + 2] = y;
    }
    ctx.putImageData(dados, 0, 0);

    return new Promise((ok, falha) =>
      c.toBlob((b) => (b ? ok(b) : falha(new Error("imagem"))), "image/png"));
  }

  const mensagemDoErro = (erro) => String(erro?.message || erro || "");

  async function lerImagem(arquivo) {
    // Alguns celulares mandam o arquivo sem tipo; só recusa se for claramente outra coisa.
    if (!arquivo || (arquivo.type && !arquivo.type.startsWith("image/"))) return;
    etapaImport("lendo");
    $("import-progresso").style.setProperty("--p", "0%");
    $("import-status").textContent = "Carregando o leitor…";
    const thumb = $("import-thumb");
    if (thumb.src.startsWith("blob:")) URL.revokeObjectURL(thumb.src);
    thumb.src = URL.createObjectURL(arquivo);

    let Tesseract;
    try {
      Tesseract = await carregarTesseract();
    } catch {
      etapaImport("inicio");
      $("import-erro").textContent =
        "Não consegui baixar o leitor de imagem. Confira a internet (ou se algum bloqueador de anúncios está barrando o site) e tente de novo.";
      return;
    }

    let worker;
    try {
      worker = await Tesseract.createWorker("por", 1, {
        logger: (m) => {
          if (m.status === "recognizing text") {
            $("import-status").textContent = `Lendo as notas… ${Math.round(m.progress * 100)}%`;
            $("import-progresso").style.setProperty("--p", `${m.progress * 100}%`);
          } else if (m.status) {
            $("import-status").textContent = "Preparando o leitor…";
          }
        },
      });

      let data;
      try {
        ({ data } = await worker.recognize(await prepararImagem(arquivo)));
      } catch {
        // Celular com pouca memória: tenta de novo com a imagem menor.
        $("import-status").textContent = "Tentando de novo com a imagem menor…";
        ({ data } = await worker.recognize(await prepararImagem(arquivo, 1_500_000)));
      }

      window.__textoOCR = data.text; // útil para ajustar a leitura (veja no console)
      // Primeiro tenta o layout em colunas do app; se não achar nada, usa a leitura por texto.
      importadas = interpretarColunas(data);
      if (!importadas.length) importadas = interpretarTexto(data.text);
      etapaImport("revisar");
      mostrarRevisao();
    } catch (erro) {
      etapaImport("inicio");
      const detalhe = mensagemDoErro(erro);
      const rede = /network|fetch|load|failed to fetch|traineddata/i.test(detalhe);
      $("import-erro").textContent = rede
        ? "Não consegui baixar os arquivos do leitor. Confira a internet e tente de novo."
        : `Não consegui ler esse print. Tente um print só da tela de notas. (Detalhe: ${detalhe || "erro desconhecido"})`;
    } finally {
      worker?.terminate().catch(() => {});
    }
  }

  function abrirImport() {
    etapaImport("inicio");
    $("import-erro").textContent = "";
    $("import-arquivo").value = "";
    dialogoImport.showModal();
  }

  $("import").addEventListener("click", () => {
    // Na primeira vez, mostra o tutorial antes.
    if (!prefs.tutorialVisto) {
      abrirTutorial({ depois: "importar" });
      return;
    }
    abrirImport();
  });

  // ---------- Tutorial do print ----------

  const dialogoTutorial = $("tutorial-dialog");
  const TOTAL_PASSOS = 4;
  let passoTutorial = 1;
  let tutorialDepois = null; // "importar": ao terminar, abre o pop-up de importar

  function irParaPasso(n) {
    passoTutorial = Math.min(TOTAL_PASSOS, Math.max(1, n));
    dialogoTutorial.dataset.passo = passoTutorial;
    dialogoTutorial.querySelectorAll(".tut-passo").forEach((li) => {
      li.hidden = Number(li.dataset.n) !== passoTutorial;
    });
    dialogoTutorial.querySelectorAll("[data-ir]").forEach((b) => {
      b.setAttribute("aria-current", String(Number(b.dataset.ir) === passoTutorial));
    });
    $("tutorial-voltar").hidden = passoTutorial === 1;
    $("tutorial-proximo").textContent = passoTutorial < TOTAL_PASSOS
      ? "Próximo"
      : tutorialDepois === "importar" ? "Escolher print" : "Entendi";
  }

  function abrirTutorial({ depois = null } = {}) {
    tutorialDepois = depois;
    irParaPasso(1);
    dialogoTutorial.showModal();
    $("tutorial-proximo").focus();
  }

  function concluirTutorial() {
    prefs.tutorialVisto = true;
    salvarPrefs();
    dialogoTutorial.close("fim");
  }

  $("tutorial-abrir").addEventListener("click", () => {
    dialogoImport.close();
    abrirTutorial({ depois: "importar" });
  });

  $("tutorial-proximo").addEventListener("click", () => {
    if (passoTutorial < TOTAL_PASSOS) irParaPasso(passoTutorial + 1);
    else concluirTutorial();
  });
  $("tutorial-voltar").addEventListener("click", () => irParaPasso(passoTutorial - 1));
  $("tutorial-fechar").addEventListener("click", concluirTutorial);
  dialogoTutorial.querySelectorAll("[data-ir]").forEach((b) =>
    b.addEventListener("click", () => irParaPasso(Number(b.dataset.ir))));

  // Setas do teclado e deslizar o dedo trocam de passo.
  dialogoTutorial.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") irParaPasso(passoTutorial + 1);
    if (e.key === "ArrowLeft") irParaPasso(passoTutorial - 1);
  });
  let toqueX = null;
  dialogoTutorial.addEventListener("touchstart", (e) => { toqueX = e.touches[0].clientX; }, { passive: true });
  dialogoTutorial.addEventListener("touchend", (e) => {
    if (toqueX === null) return;
    const dx = e.changedTouches[0].clientX - toqueX;
    toqueX = null;
    if (Math.abs(dx) > 50) irParaPasso(passoTutorial + (dx < 0 ? 1 : -1));
  });

  // Fechou de qualquer jeito (X, Esc, fora, ou terminou): marca como visto e volta para o importar.
  dialogoTutorial.addEventListener("close", () => {
    prefs.tutorialVisto = true;
    salvarPrefs();
    if (tutorialDepois === "importar") {
      tutorialDepois = null;
      abrirImport();
    }
  });

  $("import-fechar").addEventListener("click", () => dialogoImport.close());
  $("import-voltar").addEventListener("click", () => etapaImport("inicio"));
  $("import-arquivo").addEventListener("change", (e) => lerImagem(e.target.files[0]));

  const zona = $("import-zona");
  ["dragenter", "dragover"].forEach((ev) => zona.addEventListener(ev, (e) => {
    e.preventDefault();
    zona.classList.add("arrastando");
  }));
  ["dragleave", "drop"].forEach((ev) => zona.addEventListener(ev, () => zona.classList.remove("arrastando")));
  zona.addEventListener("drop", (e) => {
    e.preventDefault();
    lerImagem(e.dataTransfer.files[0]);
  });

  // Colar o print com Ctrl+V enquanto o pop-up está aberto
  document.addEventListener("paste", (e) => {
    if (!dialogoImport.open || dialogoImport.dataset.etapa !== "inicio") return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item) lerImagem(item.getAsFile());
  });

  $("import-aplicar").addEventListener("click", async () => {
    const lista2 = importadas.filter((m) => m.name.trim() || IDS.some((id) => m[id] !== ""));
    if (!lista2.length) return;

    dialogoImport.close();
    if (algumaNota()) {
      const ok = await confirmar({
        titulo: "Substituir suas matérias?",
        texto: `As matérias atuais serão trocadas pelas ${lista2.length} lidas do print.`,
        acao: "Substituir",
        icone: "importar",
      });
      if (!ok) {
        dialogoImport.showModal();
        return;
      }
    }

    estado.materias = lista2.map((m) => novaMateria(m));
    salvar();
    renderizar();
    document.querySelector(".resumo").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ---------- Tema ----------

  const corTema = { light: "#e6e9ee", dark: "#0b0e13" };
  function aplicarTema(tema) {
    raiz.dataset.theme = tema;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", corTema[tema]);
  }
  aplicarTema(raiz.dataset.theme === "dark" ? "dark" : "light");
  $("theme").addEventListener("click", () => {
    aplicarTema(raiz.dataset.theme === "dark" ? "light" : "dark");
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    aplicarTema(e.matches ? "dark" : "light");
  });

  // ---------- Barra superior no celular: linha embaixo quando rola ----------

  const appbar = document.querySelector(".appbar");
  const marcarRolagem = () => appbar.classList.toggle("rolou", scrollY > 8);
  addEventListener("scroll", marcarRolagem, { passive: true });
  marcarRolagem();

  // ---------- Histórico de semestres ----------

  const CHAVE_HISTORICO = "calc-media-facens-historico";

  function carregarHistorico() {
    try {
      const h = JSON.parse(localStorage.getItem(CHAVE_HISTORICO) || "[]");
      return Array.isArray(h) ? h.filter(semestreValido) : [];
    } catch {
      return [];
    }
  }

  function semestreValido(s) {
    return s && typeof s.nome === "string" && Array.isArray(s.materias) &&
      s.materias.every((m) => m && typeof m.name === "string" && Number.isFinite(m.media));
  }

  let historico = carregarHistorico();

  function salvarHistorico() {
    try { localStorage.setItem(CHAVE_HISTORICO, JSON.stringify(historico)); } catch { /* sem armazenamento */ }
  }

  const semestreSugerido = () => {
    const hoje = new Date();
    return `${hoje.getFullYear()}.${hoje.getMonth() < 6 ? 1 : 2}`;
  };

  const mediaDe = (materias) =>
    materias.length ? materias.reduce((t, m) => t + m.media, 0) / materias.length : null;

  function mostrarHistorico() {
    const { meta } = lerMeta();
    const todas = historico.flatMap((s) => s.materias);
    const cr = mediaDe(todas);

    $("cr-valor").textContent = cr === null ? "—" : formatar(cr);
    $("cr-detalhe").textContent = cr === null
      ? "Feche um semestre para começar o histórico"
      : `${todas.length} ${todas.length === 1 ? "matéria" : "matérias"} em ${historico.length} ${historico.length === 1 ? "semestre" : "semestres"}`;

    const grafico = $("sem-grafico");
    grafico.hidden = historico.length === 0;
    grafico.style.setProperty("--meta", `${meta * 10}%`);
    grafico.innerHTML = historico.map((s) => {
      const media = mediaDe(s.materias) ?? 0;
      const passa = media >= meta - 1e-9;
      return `
        <div class="sem-barra" data-passa="${passa ? "sim" : "nao"}">
          <span class="sem-barra-valor">${formatar(media)}</span>
          <span class="sem-barra-trilho"><i style="height:${media * 10}%"></i></span>
          <span class="sem-barra-nome">${escaparHTML(s.nome)}</span>
        </div>`;
    }).join("");

    $("sem-lista").innerHTML = historico.length
      ? [...historico].reverse().map((s) => {
        const i = historico.indexOf(s);
        const media = mediaDe(s.materias);
        return `
          <li>
            <div>
              <b>${escaparHTML(s.nome)}</b>
              <small>${s.materias.map((m) => escaparHTML(m.name)).join(" · ")}</small>
            </div>
            <span class="sem-media">${media === null ? "—" : formatar(media)}</span>
            <button type="button" class="icon-btn" data-remover-semestre="${i}" aria-label="Apagar ${escaparHTML(s.nome)}" title="Apagar semestre">${iconeX}</button>
          </li>`;
      }).join("")
      : "";

    $("sem-nome").value ||= semestreSugerido();
  }

  $("open-semestres").addEventListener("click", () => {
    $("sem-nome").value = semestreSugerido();
    $("sem-erro").textContent = "";
    mostrarHistorico();
    $("semestres-dialog").showModal();
  });
  $("semestres-fechar").addEventListener("click", () => $("semestres-dialog").close());

  /** Abre o pop-up de confirmação por cima do de semestres e volta para ele depois. */
  async function confirmarDentro(opcoes) {
    const d = $("semestres-dialog");
    d.close();
    const ok = await confirmar(opcoes);
    mostrarHistorico();
    d.showModal();
    return ok;
  }

  $("sem-fechar-atual").addEventListener("click", async () => {
    const { meta } = lerMeta();
    const fechadas = estado.materias
      .map((m, i) => ({ m, i, r: avaliarMateria(m, meta) }))
      .filter(({ r }) => r.completa)
      .map(({ m, i, r }) => ({ name: nomeDe(m, i), media: Math.round(r.media * 100) / 100, texto: r.texto }));

    if (!fechadas.length) {
      $("sem-erro").textContent = "Complete as 4 notas de pelo menos uma matéria para fechar o semestre.";
      return;
    }

    const nome = $("sem-nome").value.trim().slice(0, 20) || semestreSugerido();
    const ok = await confirmarDentro({
      titulo: `Fechar o semestre ${nome}?`,
      texto: `${fechadas.length} ${fechadas.length === 1 ? "matéria completa vai" : "matérias completas vão"} para o histórico e a calculadora começa um semestre novo, vazio.`,
      acao: "Fechar semestre",
      icone: "importar",
      perigo: false,
    });
    if (!ok) return;

    historico.push({ nome, data: new Date().toISOString().slice(0, 10), materias: fechadas });
    salvarHistorico();
    aplicarDados({ meta: estado.meta, pesos: estado.pesos });
    salvar();
    iniciar();
    $("sem-nome").value = "";
    mostrarHistorico();
  });

  $("sem-lista").addEventListener("click", async (e) => {
    const botao = e.target.closest("[data-remover-semestre]");
    if (!botao) return;
    const i = Number(botao.dataset.removerSemestre);
    const s = historico[i];
    if (!s) return;
    const ok = await confirmarDentro({
      titulo: `Apagar o semestre ${s.nome}?`,
      texto: "As médias dele saem do histórico e da média do curso. Não dá para desfazer.",
      acao: "Apagar",
      icone: "lixeira",
    });
    if (!ok) return;
    historico.splice(i, 1);
    salvarHistorico();
    mostrarHistorico();
  });

  // ---------- Backup (.json) ----------

  $("backup-exportar").addEventListener("click", () => {
    const dados = {
      app: "calculadora-media-facens",
      versao: 1,
      exportado: new Date().toISOString(),
      atual: exportarDados(),
      historico,
    };
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `media-facens-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $("backup-arquivo").addEventListener("change", async (e) => {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;

    let dados;
    try {
      dados = JSON.parse(await arquivo.text());
    } catch {
      dados = null;
    }
    if (!dados || dados.app !== "calculadora-media-facens" || !Array.isArray(dados.atual?.subjects)) {
      $("sem-erro").textContent = "Esse arquivo não é um backup da calculadora.";
      return;
    }

    const ok = await confirmarDentro({
      titulo: "Restaurar este backup?",
      texto: "As notas atuais e o histórico deste navegador serão trocados pelos do arquivo.",
      acao: "Restaurar",
      icone: "importar",
    });
    if (!ok) return;

    aplicarDados(dados.atual);
    historico = Array.isArray(dados.historico) ? dados.historico.filter(semestreValido) : [];
    salvar();
    salvarHistorico();
    iniciar();
    $("sem-erro").textContent = "";
    mostrarHistorico();
  });

  // ---------- Início ----------

  aplicarDados(carregarSalvo());

  // Abriu um link compartilhado? Carrega as notas dele.
  const doLink = lerLink();
  history.replaceState(null, "", location.pathname + location.search);

  function iniciar() {
    $("meta").value = estado.meta;
    renderizar();
    mostrarPesos();
  }

  $("ano").textContent = new Date().getFullYear();
  iniciar();

  if (doLink) {
    (async () => {
      const ok = !algumaNota() || await confirmar({
        titulo: "Abrir as notas deste link?",
        texto: "As notas salvas neste navegador serão substituídas pelas do link.",
        acao: "Abrir notas",
        icone: "link",
        perigo: false,
      });
      if (!ok) return;
      aplicarDados(doLink);
      salvar();
      iniciar();
    })();
  }
})();
