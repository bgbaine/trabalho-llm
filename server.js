import express from "express";
import cors from "cors";
import multer from "multer";
import pdfParse from "pdf-parse";
import "dotenv/config";

const app = express();
const PORT = 3000;
const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = "openai/gpt-oss-120b:free";

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
  const textoNormalizado = textoPdf.toLowerCase();
  const keywordsTaf = [
    'taf', 'teste de aptidão física', 'aptidão física',
    'corrida', 'flexão', 'abdominal', 'barra',
    'cooper', 'abdômen', 'impulsão', 'resistência',
    'exercício', 'série', 'repetição', 'tempo',
    'pontuação', 'ponto', 'prova', 'candidato',
    'sexo', 'idade', 'categoria', 'modalidade',
    'metros', 'minuto', 'segundo', 'respetivo',
    'capacitação física', 'exame de capacitação física',
    'avaliação física', 'desempenho'
  ];

  const linhas = textoPdf.split('\n');
  const linhasRelevantes = [];

  linhas.forEach(line => {
    const lineLower = line.toLowerCase();
    if (keywordsTaf.some(keyword => lineLower.includes(keyword))) {
      const cleanLine = line.trim();
      if (cleanLine.length > 0) {
        linhasRelevantes.push(cleanLine);
      }
    }
  });

  if (linhasRelevantes.length < 20) {
    return textoPdf.substring(0, 3000); // Limitar a 3000 caracteres do início
  }

  let textoProcessado = linhasRelevantes.join('\n');
  if (textoProcessado.length > 3000) {
    textoProcessado = textoProcessado.substring(0, 3000);
  }

  return textoProcessado;
}

// Endpoint existente para gerar plano com a LLM
app.post("/api/llm", async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ erro: "O campo prompt é obrigatório." });
    }

    if (prompt.length > 5000) {
      return res.status(400).json({ erro: "Limite: 5000 caracteres." });
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
              content: `
Você é um treinador especializado em preparação para TAF (Teste de Aptidão Física) de concursos públicos.

Analise o edital ou informações sobre o TAF fornecidas pelo usuário. Identifique as modalidades, critérios de desempenho, e requisitos específicos.

Se informações pessoais do candidato forem mencionadas (idade, sexo, peso, altura, disponibilidade), utilize essas informações para personalizar o plano.

Quando houver informações insuficientes:
- Não invente valores.
- Faça recomendações gerais e seguras.
- Liste quais informações adicionais poderiam melhorar a personalização.

Seu objetivo é criar um plano de preparação para o TAF focado na evolução gradual do candidato baseado no edital fornecido.

Retorne EXCLUSIVAMENTE um JSON válido.

Formato:

{
  "resumo": "",
  "informacoesIdentificadas": {
    "idade": null,
    "sexo": null,
    "peso": null,
    "altura": null,
    "prazoProva": null,
    "diasDisponiveis": null,
    "modalidades": []
  },
  "informacoesFaltantes": [],
  "avaliacao": "",
  "cronograma": [
    {
      "dia": "",
      "objetivo": "",
      "atividades": []
    }
  ],
  "recomendacoes": [],
  "alimentacao": [],
  "cuidados": []
}

Regras:
- Sempre retornar JSON válido.
- Nunca retornar markdown.
- Nunca retornar texto fora do JSON.
- Não repetir informações.
- Adaptar o plano aos dados disponíveis.
- Se o edital informar modalidades específicas do TAF, priorize essas modalidades.
- Caso o edital não seja claro, monte um plano físico geral para TAF.
`,
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.7,
          max_completion_tokens: 700,
        }),
      },
    );

    if (!response.ok) {
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
