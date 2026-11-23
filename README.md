# Calculadora de Média Facens

Fiz essa calculadora porque todo fim de semestre era a mesma coisa: abrir o app da
Facens, pegar as notas, jogar numa conta no papel (ou no WhatsApp com alguém da
sala) pra descobrir quanto eu precisava tirar na AF. Cansei e resolvi fazer um site
que faz isso sozinho.

É um site simples, só HTML, CSS e JavaScript. Não tem servidor, não tem login, não
manda suas notas pra lugar nenhum.

> **Aviso:** isso **não é** uma ferramenta oficial da Facens. Fiz por conta própria.
> Sempre confira a regra de cada disciplina no Plano de Ensino.

## O que dá pra fazer

- **Calcular a média** de cada matéria com os pesos da Facens (AC1 15%, AC2 30%,
  AG 10% e AF 45%).
- **Saber quanto precisa na AF.** Deixa a AF em branco que ele te fala a nota
  mínima pra passar.
- **Simular a AF** num controle deslizante, tipo "e se eu tirar 5?", e ver a
  média final mudando na hora.
- **Importar as notas por print.** Tira um print da tela de notas do app da Facens
  e manda pro site. Ele lê os nomes das matérias e as notas sozinho. Antes de
  preencher, aparece uma tabela pra você conferir, porque às vezes o leitor erra
  um número ou outro.
- **Compartilhar** suas médias numa imagem no formato de story, com 5 cores pra
  escolher. Também dá pra gerar um link com as notas pra mandar pra alguém.
- **Mudar os pesos** se alguma matéria usar uma conta diferente.
- **Adicionar e remover matérias** (até 12).
- **Ver o resumo do semestre**: média geral e quantas matérias estão aprovadas, em
  risco ou dependendo da AF.
- **Tema claro e escuro**, que segue o do seu celular ou computador.
- **Instalar como app** no celular, pelo "Adicionar à tela inicial".

## Sobre a AS (substitutiva)

O site tem um campo pra AS, mas ainda não tenho certeza de como ela funciona de
verdade na Facens. Do jeito que está, a nota da AS entra no lugar da nota que mais
ajuda (normalmente a AF) e só conta se for maior que a nota original. Se alguém
souber a regra certinha, me avisa que eu corrijo.

## Como usar

É só abrir o `index.html` no navegador. Pronto.

As notas ficam salvas no próprio navegador. Se você limpar os dados do navegador ou
trocar de aparelho, elas somem. Pra levar pra outro lugar, usa o link de
compartilhar.

### Rodando localmente

Abrindo direto o arquivo já funciona quase tudo. Se quiser testar a parte de
instalar como app, precisa de um servidor. Qualquer um serve, por exemplo:

```bash
python -m http.server 5173
```

E abre `http://localhost:5173`.

## Privacidade

- As notas ficam só no seu navegador (`localStorage`).
- A leitura do print acontece no seu aparelho mesmo, usando o
  [Tesseract.js](https://github.com/naptha/tesseract.js). A imagem não é enviada
  pra nenhum servidor. Na primeira vez ele baixa os arquivos do leitor da
  internet, por isso pode demorar uns segundos.
- O link de compartilhar leva as notas dentro do próprio link (depois do `#`).
  Então só manda pra quem você quiser que veja.

## Arquivos

```
index.html                    a página
calculadora-media-facens.css  o visual
calculadora-media-facens.js   toda a lógica
favicon.svg                   ícone da aba
manifest.webmanifest          configuração pra instalar como app
icons/                        ícones do app
facens-logo.png               logo
```

Feito por Pedro Henrique Marcelino.
