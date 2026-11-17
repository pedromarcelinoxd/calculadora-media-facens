(() => {
  const PESOS = {
    ac1: 0.15,
    ac2: 0.30,
    ag: 0.10,
    af: 0.45,
  };

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
                <small>${Math.round(PESOS[id] * 100)}%</small>
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
        JSON.stringify({ subjects, meta: elemento("meta").value }),
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
          avisoAF.textContent = `Máximo: ${formatar(media + 4.5)}`;
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

  calcularMedias();
})();