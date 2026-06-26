import express from "express";
import cors from "cors";
import multer from "multer";
import pdfParse from "pdf-parse";
import "dotenv/config";

const app = express();
const PORT = 3000;
const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = "openai/gpt-oss-120b:free";
const TAF_CHAR_LIMIT = 20000;

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Apenas arquivos PDF são aceitos'));
    } else {
      cb(null, true);
    }
  }
});

if (!API_KEY) {
  console.error("Erro: configure OPENROUTER_API_KEY no arquivo .env.");
  process.exit(1);
}

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.get("/api/status", (req, res) => {
  res.json({ status: "API local funcionando", model: MODEL });
});

app.post("/api/extract-pdf", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ erro: "Nenhum arquivo PDF foi enviado." });
    }

    const dadosPdf = await pdfParse(req.file.buffer);
    const textoPdf = dadosPdf.text;

    if (!textoPdf || textoPdf.trim().length === 0) {
      return res.status(400).json({ 
        erro: "Não foi possível extrair texto do PDF. Certifique-se de que é um PDF válido com texto." 
      });
    }

    const dadosTaf = extrairDadosTAF(textoPdf);

    res.json({ 
      sucesso: true,
      textoExtraido: dadosTaf,
      totalPaginas: dadosPdf.numpages,
      nomeArquivo: req.file.originalname
    });
  } catch (error) {
    console.error("Erro ao processar PDF:", error);
    res.status(500).json({ 
      erro: "Erro ao processar o PDF.",
      detalhe: error.message 
    });
  }
});

function extrairDadosTAF(textoPdf) {

  const keywordsForte = [
    'teste de aptidão física', 'aptidão física', 'capacitação física',
    'exame de capacitação física', 'avaliação física', 'taf',
    'corrida', 'cooper', 'flex', 'abdomin', 'barra', 'natação', 'nataç',
    'salto', 'impulsão', 'shuttle run', 'vai e vem', 'prancha',
    'apoio de frente', 'agachamento', 'polichinelo', 'burpee',
    'resistência', 'agilidade', 'flexibilidade', 'velocidade',
    'sentar e alcançar', 'wells', 'distância'
  ];

  
  const keywordsFraca = [
    'pontuação', 'pontos', 'apto', 'inapto', 'aprovado', 'reprovado', 'eliminat',
    'faixa etária', 'masculino', 'feminino', 'índice mínimo', 'índices mínimos',
    'mínimo exigido', 'tabela de', 'critério', 'modalidade'
  ];

  
  const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');
  const semAcento = (str) => str.normalize('NFD').replace(DIACRITICOS, '');
  const keywordsForteNormalizadas = keywordsForte.map(semAcento);
  const keywordsFracaNormalizadas = keywordsFraca.map(semAcento);

  const linhas = textoPdf.split('\n');
  const n = linhas.length;
  const temKeywordForte = new Array(n);
  const podeContinuar = new Array(n);

  linhas.forEach((line, idx) => {
    const lineLower = semAcento(line.toLowerCase());
    temKeywordForte[idx] = keywordsForteNormalizadas.some(keyword => lineLower.includes(keyword));
    const temKeywordFraca = keywordsFracaNormalizadas.some(keyword => lineLower.includes(keyword));
    const numerosEncontrados = line.match(/\d+(?:[.,]\d+)?/g) || [];
    const temTabelaNumerica = numerosEncontrados.length >= 2;
    podeContinuar[idx] = temKeywordFraca || temTabelaNumerica;
  });

  const relevante = new Array(n).fill(false);

  // Percorrer as linhas do pdf de cima para baixo 
  let emCadeia = false;
  for (let i = 0; i < n; i++) {
    if (temKeywordForte[i]) {
      relevante[i] = true;
      emCadeia = true;
    } else if (emCadeia && (linhas[i].trim().length === 0 || podeContinuar[i])) {
      relevante[i] = true;
    } else {
      emCadeia = false;
    }
  }

  // Percorrer as linhas do pdf de baixo para cima
  emCadeia = false;
  for (let i = n - 1; i >= 0; i--) {
    if (temKeywordForte[i]) {
      relevante[i] = true;
      emCadeia = true;
    } else if (emCadeia && (linhas[i].trim().length === 0 || podeContinuar[i])) {
      relevante[i] = true;
    } else {
      emCadeia = false;
    }
  }

  let textoProcessado = '';
  let ultimoIndice = null;
  for (let idx = 0; idx < n; idx++) {
    if (!relevante[idx]) continue;
    const linha = linhas[idx].trim();
    if (linha.length === 0) continue;
    if (ultimoIndice !== null && idx > ultimoIndice + 1) {
      textoProcessado += '\n[...]\n';
    }
    textoProcessado += linha + '\n';
    ultimoIndice = idx;
  }
  textoProcessado = textoProcessado.trim();

  if (textoProcessado.length < 500) {
    return textoPdf.substring(0, TAF_CHAR_LIMIT);
  }

  if (textoProcessado.length > TAF_CHAR_LIMIT) {
    textoProcessado = textoProcessado.substring(0, TAF_CHAR_LIMIT);
  }

  return textoProcessado;
}

const SYSTEM_PROMPT = `
Você é um especialista em editais de concursos públicos e em TAF (Teste de Aptidão Física), com profundo conhecimento das modalidades mais comuns (corrida/Cooper, flexão de braço, abdominal, barra fixa, natação, salto em distância, shuttle run, entre outras) e de como esses editais estruturam tabelas de pontuação por sexo e faixa etária.

Você recebe APENAS um trecho de texto extraído automaticamente de um PDF de edital (sem nenhuma informação pessoal do candidato, como idade, sexo, peso, altura ou disponibilidade de treino). O texto pode vir com formatação imperfeita (colunas desalinhadas, linhas de tabela fragmentadas) porque é extraído de forma automática — use seu conhecimento de como tabelas de TAF costumam ser organizadas para reconstruir essas informações da forma mais fiel possível ao que está no edital.

Sua tarefa:
1. Identificar todas as modalidades/provas físicas exigidas no edital.
2. Para cada modalidade, reconstruir a tabela de critérios de desempenho × pontuação (ou apto/inapto), separando por sexo e faixa etária quando o edital fizer essa distinção.
3. Identificar se cada modalidade é eliminatória (reprova o candidato) ou apenas pontua.
4. Identificar a data da prova, se estiver explícita no edital.
5. Como não há dados pessoais do candidato, montar um cronograma de treino GERAL e progressivo (por fases/dias), baseado nas modalidades identificadas — sem assumir idade, sexo, peso ou nível de condicionamento físico do candidato.

Regras importantes:
- Nunca invente valores numéricos de tabelas de pontuação. Se um valor não estiver claro no texto, omita-o e relate em "informacoesFaltantes".
- Não assuma dados pessoais do candidato: eles não existem nesse fluxo.
- Se o edital não detalhar uma modalidade ou tabela, liste a lacuna em "informacoesFaltantes".
- Retorne EXCLUSIVAMENTE um JSON válido, sem markdown e sem texto fora do JSON.

Formato:

{
  "resumo": "",
  "dataProva": null,
  "modalidades": [
    {
      "nome": "",
      "descricao": "",
      "eliminatoria": false,
      "criterios": [
        {
          "sexo": null,
          "faixaEtaria": "",
          "tabela": [
            { "desempenho": "", "pontuacao": "" }
          ]
        }
      ]
    }
  ],
  "informacoesFaltantes": [],
  "cronograma": [
    {
      "dia": "",
      "objetivo": "",
      "atividades": []
    }
  ],
  "alimentacao": [],
  "cuidados": []
}

Regras de formatação:
- Sempre retornar JSON válido.
- Nunca retornar markdown.
- Nunca retornar texto fora do JSON.
- Não repetir informações.
- Se o edital não informar "sexo" ou "faixaEtaria" para um critério, use null nesses campos em vez de inventar.
- Se uma modalidade não tiver tabela de pontuação identificável no texto, retorne "criterios": [] e explique a lacuna em "informacoesFaltantes".
`;

app.post("/api/llm", async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ erro: "O campo prompt é obrigatório." });
    }

    if (prompt.length > 21000) {
      return res.status(400).json({ erro: "Limite: 21000 caracteres." });
    }

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:3000",
          "X-OpenRouter-Title": "Projeto FIA ADS",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            {
              role: "system",
              content: SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.7,
          max_completion_tokens: 3000,
        }),
      },
    );

    if (!response.ok) {
      console.log(response);
      const detalhe = await response.text();
      return res.status(502).json({
        erro: "Erro ao consultar o OpenRouter.",
        status: response.status,
        detalhe,
      });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      return res.status(502).json({ erro: "Resposta vazia ou inesperada." });
    }

    res.json({ modelo: MODEL, resposta: text, uso: data.usage ?? null });
  } catch (error) {
    res
      .status(500)
      .json({ erro: "Erro interno no servidor.", detalhe: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
