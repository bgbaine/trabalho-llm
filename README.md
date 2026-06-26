# Planejador TAF

Aplicação web para apoiar candidatos na preparação para TAF (Teste de Aptidão Física) a partir do edital em PDF.

O sistema é orientado por documento: o usuário envia o edital em PDF e a aplicação executa um fluxo automático para extrair texto e gerar um plano de treino com IA.

Fluxo principal:

1. Upload do edital em PDF (até 10 MB).
2. Extração de texto relevante para TAF.
3. Envio do conteúdo para o modelo via OpenRouter.
4. Exibição de plano estruturado na interface.

## Funcionalidades

- Upload de arquivo PDF diretamente na interface.
- Extração de texto com filtro para termos de TAF.
- Geração de plano com saída em JSON estruturado.
- Renderização visual do plano com seções:
	- Resumo
	- Informações identificadas
	- Informações faltantes
	- Avaliação
	- Cronograma
	- Recomendações
	- Alimentação
	- Cuidados

## Arquitetura resumida

- Backend: Node.js + Express
- Frontend: HTML/CSS/JavaScript (estático em `public/`)
- Upload de arquivos: Multer (memória)
- Extração de PDF: `pdf-parse`
- IA: OpenRouter Chat Completions

## Endpoints

- `GET /api/status`: valida se a API está ativa.
- `POST /api/extract-pdf`: recebe arquivo `pdf` e retorna texto extraído.
- `POST /api/llm`: recebe `prompt` e retorna a resposta do modelo.

## Requisitos

- Node.js 18+ (recomendado)
- Chave da OpenRouter

## Configuração

Crie um arquivo `.env` na raiz:

```env
OPENROUTER_API_KEY=sua_chave_aqui
```

## Como executar

```bash
npm install
npm start
```

Aplicação disponível em `http://localhost:3000`.

## Como usar

1. Abra a aplicação no navegador.
2. Selecione um edital em PDF.
3. Clique em **Processar Edital**.
4. Aguarde a extração e a geração do plano.
5. Analise o resultado renderizado na tela.
