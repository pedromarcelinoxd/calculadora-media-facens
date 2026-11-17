(() => {
  const PESOS_PADRAO = {
    ac1: 0.15,
    ac2: 0.30,
    ag: 0.10,
    af: 0.45,
  };

  // Pesos em uso (podem ser alterados no pop-up "Pesos").
  const PESOS = { ...PESOS_PADRAO };

  const IDS = Object.keys(PESOS);
  const CHAVE = "calc-media-facens-v2";
  const elemento = (id) => document.getElementById(id);

  const formatar = (numero) => numero.toFixed(2).replace(".", ",");

  function interpretarNota(valor) {
    const texto = String(valor).trim().replace(",", ".");

    if (texto === "") return null;

    const numero = Number(texto);
    const valido = Number.isFinite(numero) && numero >= 0 && numero <= 10;

    return valido ? numero : NaN;
  }

  const materiasPadrao = Array.from({ length: 6 }, (_, indice) => ({
    name: `Matéria ${indice + 1}`,
    ac1: "",
    ac2: "",
    ag: "",
    af: "",
  }));

  let dadosSalvos;

  try {
    dadosSalvos = JSON.parse(localStorage.getItem(CHAVE) || "null");
  } catch {
    dadosSalvos = null;
  }

  // Carrega pesos salvos, se forem válidos (cada um de 0 a 1 e somando 100%).
  const pesosSalvos = dadosSalvos?.pesos;
  if (
    pesosSalvos &&
    IDS.every((id) => Number.isFinite(pesosSalvos[id]) && pesosSalvos[id] >= 0 && pesosSalvos[id] <= 1) &&
    Math.abs(IDS.reduce((t, id) => t + pesosSalvos[id], 0) - 1) < 1e-6
  ) {
    IDS.forEach((id) => {
      PESOS[id] = pesosSalvos[id];
    });
  }

  const materias = Array.from({ length: 6 }, (_, indice) => ({
    ...materiasPadrao[indice],
    ...(dadosSalvos?.subjects?.[indice] || {}),
  }));

  const rotulos = {
    ac1: "AC1",
    ac2: "AC2",
    ag: "AG",
    af: "AF",
  };

  elemento("subjects").innerHTML = materias
    .map((_, indice) => `
      <article class="card" aria-label="Matéria ${indice + 1}">
        <div class="head">
          <input
            class="name"
            type="text"
            maxlength="50"
            aria-label="Nome da matéria ${indice + 1}"
            data-name="${indice}"
            value=""
          >
          <span class="avg" id="avg-${indice}">0,00<small>/10</small></span>
        </div>

        <div class="bar" aria-hidden="true">
          <span id="bar-${indice}"></span><i></i>
        </div>

        <div class="grades">
          ${IDS.map((id) => `
            <div class="grade">
              <label for="${id}-${indice}">
                ${rotulos[id]}
                <small data-peso="${id}"></small>
              </label>
              <input
                type="text"
                inputmode="decimal"
                id="${id}-${indice}"
                data-grade="${indice}"
                data-key="${id}"
                placeholder="—"
                autocomplete="off"
                aria-label="${id.toUpperCase()} da matéria ${indice + 1}"
              >
            </div>
          `).join("")}
        </div>

        <div class="cardfoot">
          <span class="status" id="status-${indice}">Preencha as notas</span>
          <span class="note" id="required-${indice}"></span>
        </div>
      </article>
    `)
    .join("");

  materias.forEach((materia, indice) => {
    const campoNome = document.querySelector(`[data-name="${indice}"]`);
    campoNome.value = materia.name || `Matéria ${indice + 1}`;

    IDS.forEach((id) => {
      elemento(`${id}-${indice}`).value = materia[id] || "";
    });
  });

  elemento("meta").value = dadosSalvos?.meta || "6,0";

  function salvarDados() {
    const subjects = materias.map((materia, indice) => ({
      name: document.querySelector(`[data-name="${indice}"]`).value,
      ...Object.fromEntries(
        IDS.map((id) => [id, elemento(`${id}-${indice}`).value]),
      ),
    }));

    try {
      localStorage.setItem(
        CHAVE,
        JSON.stringify({ subjects, meta: elemento("meta").value, pesos: PESOS }),
      );
    } catch {
      // A calculadora continua funcionando se o navegador bloquear o armazenamento.
    }
  }

  function calcularMedias() {
    let meta = interpretarNota(elemento("meta").value);
    const metaInvalida = meta === null || Number.isNaN(meta);

    elemento("meta").classList.toggle("invalid", metaInvalida);

    if (metaInvalida) meta = 6;

    document.documentElement.style.setProperty("--meta", `${meta * 10}%`);

    materias.forEach((_, indice) => {
      const notas = {};
      let existeNotaInvalida = false;

      IDS.forEach((id) => {
        notas[id] = interpretarNota(elemento(`${id}-${indice}`).value);
        const notaInvalida = Number.isNaN(notas[id]);

        elemento(`${id}-${indice}`).classList.toggle("invalid", notaInvalida);

        if (notaInvalida) {
          existeNotaInvalida = true;
          notas[id] = null;
        }
      });

      const media = IDS.reduce(
        (total, id) => total + (notas[id] ?? 0) * PESOS[id],
        0,
      );

      elemento(`avg-${indice}`).firstChild.textContent = formatar(media);
      elemento(`bar-${indice}`).style.width = `${media * 10}%`;

      const status = elemento(`status-${indice}`);
      const avisoAF = elemento(`required-${indice}`);
      const quantidadePreenchida = IDS.filter(
        (id) => notas[id] !== null,
      ).length;

      const cartao = status.closest(".card");
      const definirEstado = (estado) => {
        cartao.dataset.state = estado;
      };

      status.className = "status";
      avisoAF.textContent = "";
      definirEstado("");

      if (existeNotaInvalida) {
        definirEstado("bad");
        status.textContent = "Use notas de 0 a 10";
        return;
      }

      if (quantidadePreenchida === IDS.length) {
        const aprovado = media >= meta - 1e-9;

        definirEstado(aprovado ? "ok" : "bad");
        status.textContent = aprovado
          ? "Aprovado por nota"
          : "Abaixo da média";
        return;
      }

      const notasAntesDaAFEstaoPreenchidas =
        notas.ac1 !== null && notas.ac2 !== null && notas.ag !== null;

      if (notas.af === null && notasAntesDaAFEstaoPreenchidas) {
        const necessaria = Math.max(0, (meta - media) / PESOS.af);

        if (necessaria > 10) {
          definirEstado("bad");
          status.textContent = "Meta fora de alcance";
          avisoAF.textContent = `Máximo: ${formatar(media + 10 * PESOS.af)}`;
          return;
        }

        if (necessaria === 0) {
          definirEstado("ok");
          status.textContent = "Meta já garantida";
          return;
        }

        const notaNecessaria = Math.ceil(necessaria * 100) / 100;

        definirEstado("warn");
        status.textContent = "Falta a AF";
        avisoAF.textContent = `Precisa de ${formatar(notaNecessaria)} na AF`;
        return;
      }

      status.textContent = "Preencha as notas";
    });
  }

  document.querySelectorAll(".name, [data-grade]").forEach((campo) => {
    campo.addEventListener("input", () => {
      salvarDados();
      calcularMedias();
    });
  });

  elemento("meta").addEventListener("input", () => {
    salvarDados();
    calcularMedias();
  });

  elemento("clear").addEventListener("click", () => {
    materias.forEach((_, indice) => {
      IDS.forEach((id) => {
        elemento(`${id}-${indice}`).value = "";
      });
    });

    salvarDados();
    calcularMedias();
    elemento("ac1-0").focus();
  });

  // ---------- Pop-up de pesos ----------

  const formatarPorcentagem = (peso) =>
    String(Math.round(peso * 10000) / 100).replace(".", ",");

  function mostrarPesos() {
    document.querySelectorAll("[data-peso]").forEach((el) => {
      el.textContent = `${formatarPorcentagem(PESOS[el.dataset.peso])}%`;
    });

    elemento("pesos-texto").textContent = IDS.map(
      (id) => `${rotulos[id]} ${formatarPorcentagem(PESOS[id])}%`,
    ).join(" · ");
  }

  const dialogo = elemento("pesos-dialog");

  elemento("pesos-campos").innerHTML = IDS.map((id) => `
    <div class="peso-campo">
      <label for="peso-${id}">${rotulos[id]}</label>
      <input
        type="text"
        inputmode="decimal"
        id="peso-${id}"
        data-peso-input="${id}"
        autocomplete="off"
      >
      <span aria-hidden="true">%</span>
    </div>
  `).join("");

  const camposPeso = IDS.map((id) => elemento(`peso-${id}`));

  function lerPesosDoDialogo() {
    return IDS.map((id, i) => {
      const texto = camposPeso[i].value.trim().replace(",", ".");
      const numero = texto === "" ? NaN : Number(texto);
      const valido = Number.isFinite(numero) && numero >= 0 && numero <= 100;
      camposPeso[i].classList.toggle("invalid", !valido);
      return valido ? numero : NaN;
    });
  }

  function validarDialogo() {
    const valores = lerPesosDoDialogo();
    const algumInvalido = valores.some(Number.isNaN);
    const soma = valores.reduce((t, v) => t + (Number.isNaN(v) ? 0 : v), 0);
    const somaCerta = Math.abs(soma - 100) < 0.01;
    const total = elemento("pesos-total");

    total.classList.toggle("erro", algumInvalido || !somaCerta);
    total.textContent = algumInvalido
      ? "Use valores de 0 a 100"
      : somaCerta
        ? "Total: 100%"
        : `Total: ${formatarPorcentagem(soma / 100)}% · precisa dar 100%`;

    elemento("pesos-salvar").disabled = algumInvalido || !somaCerta;
    return !algumInvalido && somaCerta ? valores : null;
  }

  function preencherDialogo(pesos) {
    IDS.forEach((id, i) => {
      camposPeso[i].value = formatarPorcentagem(pesos[id]);
    });
    validarDialogo();
  }

  // Link do arquivo da Facens: enquanto o href for "#", aparece como "Link em breve".
  const linkFacens = elemento("link-facens");
  const linkPendente = () => {
    const href = linkFacens.getAttribute("href") || "";
    return href === "" || href === "#";
  };

  if (linkPendente()) {
    linkFacens.setAttribute("aria-disabled", "true");
    linkFacens.addEventListener("click", (e) => e.preventDefault());
  } else {
    elemento("link-facens-aviso").textContent = "";
  }

  elemento("open-pesos").addEventListener("click", () => {
    preencherDialogo(PESOS);
    dialogo.showModal();
  });

  elemento("ano").textContent = new Date().getFullYear();

  camposPeso.forEach((campo) => campo.addEventListener("input", validarDialogo));

  elemento("pesos-padrao").addEventListener("click", () => {
    preencherDialogo(PESOS_PADRAO);
  });

  ["pesos-cancelar", "pesos-fechar"].forEach((id) => {
    elemento(id).addEventListener("click", () => dialogo.close());
  });

  // Fechar clicando fora da caixa.
  dialogo.addEventListener("click", (e) => {
    if (e.target === dialogo) dialogo.close();
  });

  elemento("pesos-form").addEventListener("submit", (e) => {
    const valores = validarDialogo();

    if (!valores) {
      e.preventDefault();
      return;
    }

    IDS.forEach((id, i) => {
      PESOS[id] = valores[i] / 100;
    });

    mostrarPesos();
    salvarDados();
    calcularMedias();
  });

  mostrarPesos();

  const raiz = document.documentElement;
  const corTema = { light: "#e6e9ee", dark: "#0b0e13" };

  function aplicarTema(tema) {
    raiz.dataset.theme = tema;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", corTema[tema]);
  }

  aplicarTema(raiz.dataset.theme === "dark" ? "dark" : "light");

  // O botão troca o tema só nesta visita; ao abrir de novo, volta ao do sistema.
  elemento("theme").addEventListener("click", () => {
    aplicarTema(raiz.dataset.theme === "dark" ? "light" : "dark");
  });

  // Se o usuário mudar o tema do sistema com a página aberta, acompanha.
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    aplicarTema(e.matches ? "dark" : "light");
  });

  calcularMedias();
})();