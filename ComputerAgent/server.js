import express from 'express';
import bodyParser from 'body-parser';
import { OpenAI } from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Initialize Express server
const app = express();
app.use(bodyParser.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files
app.use(express.static(path.resolve(process.cwd(), './public')));

// OpenAI API configuration
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Shared in-memory state with version
let state = {
  version: 0,
  agent: false,
  chat_response: true,
  assistant_id: "",
  assistant_name: "",
  dir_path: "",
  news_path: "",
  thread_id: "",
  user_message: "",
  run_id: "",
  run_status: "",
  vector_store_name: "",
  vector_store_id: "",
  tools: [],
  mcp_tools: [],
  parameters: []
};

// Default route to serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), './public/index.html'));
});

async function getFunctions() {
  const files = fs.readdirSync(path.resolve(process.cwd(), './functions'));
  const openAIFunctions = {};
  for (const file of files) {
    if (file.endsWith('.js')) {
      const moduleName = file.slice(0, -3);
      const modulePath = `./functions/${moduleName}.js`;
      const { details, execute } = await import(modulePath);
      openAIFunctions[moduleName] = { details, execute };
    }
  }
  return openAIFunctions;
}

// Helper to increment version and send delta
function sendDelta(res, message, delta) {
  state.version++;
  const stateDelta = { ...delta };
  res.json({ message, stateDelta, version: state.version });
}

// =========================
// chat_response routes
// =========================

app.post('/api/chat_response/execute-function', async (req, res) => {
  const { functionName, parameters } = req.body;
  const functions = await getFunctions();
  if (!functions[functionName]) {
    return res.status(404).json({ error: 'Function not found' });
  }
  try {
    const result = await functions[functionName].execute(...Object.values(parameters));
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Function execution failed', details: err.message });
  }
});

app.post('/api/chat_response/get_vector_store', async (req, res) => {
  const { vector_store_name } = req.body;
  try {
    const vectorStores = await openai.vectorStores.list();
    const vectorStore = vectorStores.data.find(v => v.name === vector_store_name);
    if (!vectorStore) {
      return res.status(404).json({ error: 'Vector store not found' });
    }
    state.vector_store_id = vectorStore.id;
    return sendDelta(res,
      `selected ${vectorStore.name}`,
      { vector_store_id: state.vector_store_id }
    );
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve vector store', details: err.message });
  }
});

app.post('/api/chat_response/create_vector_store', async (req, res) => {
  let { vector_store_id } = req.body;
  try {
    if (!vector_store_id) {
      const vectorStore = await openai.vectorStores.create({
        name: 'John Docs',
        description: "John's documents",
        purpose: 'vector_store'
      });
      vector_store_id = vectorStore.id;
    }
    state.vector_store_id = vector_store_id;
    // upload files, add to vector store...
    // (omitted for brevity)
    return sendDelta(res,
      `vector store ready`,
      { vector_store_id: state.vector_store_id }
    );
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create vector store', details: err.message });
  }
});

app.post('/api/chat_response/search_web', (req, res) => {
  const tool = { type: 'web_search_preview' };
  state.tools = [...state.tools, tool];
  return sendDelta(res,
    'web_search tool enabled',
    { tools: state.tools }
  );
});

app.post('/api/chat_response/prompt', (req, res) => {
  state.user_message = req.body.user_message;
  return sendDelta(res,
    `got prompt ${state.user_message}`,
    { user_message: state.user_message }
  );
});

app.post('/api/chat_response/run', async (req, res) => {
  const { user_message, vector_store_id, tools } = req.body;
  state.tools = tools;
  // check if file_search tool is enabled then inject its vector_store_id
   state.tools = state.tools.map(tool => {
    if (tool.type === 'file_search') {
        // Preserve any existing props, override vector_store_ids
        return {
        ...tool,
        vector_store_ids: [ state.vector_store_id ]
        };
    }
    // Leave all other tools untouched
    return tool;
    });
  const functions = await getFunctions();
  const avail = Object.values(functions).map(fn => fn.details);
  //if computer use tool is enabled then add functions to available tools
    if (state.tools.some(tool => tool.type === 'computer_use_preview')) {
        state.tools = [...state.tools, ...avail];
        // Computer Use Example

        let response = await openai.responses.create({
            model: "computer-use-preview",
            tools: [{
                type: "computer_use_preview",
                display_width: 1024,
                display_height: 768,
                environment: "browser",
            }],
            truncation: "auto",
            input: "I'm looking for a new camera. Help me find the best one.",
        });

        console.log(response.output_text);
         return sendDelta(res,
            response.output_text,
            { run_status: 'completed' }
            );
    }
  try {
    const response = await openai.responses.create({
      model: 'gpt-4o-mini',
      tools: [...state.tools],
      input: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: user_message }
      ]
    });
    return sendDelta(res,
      response.output_text,
      { run_status: 'completed' }
    );
  } catch (err) {
    return res.status(500).json({ error: 'OpenAI API failed', details: err.message });
  }
});

// =========================
// assistant routes
// =========================

app.post('/api/assistant/get_vector_store', (req, res) => {
  // mirror /chat_response/get_vector_store
  return sendDelta(res, 'assistant get_vector_store stub', {});
});
app.post('/api/assistant/create_vector_store', (req, res) => {
  return sendDelta(res, 'assistant create_vector_store stub', {});
});
app.post('/api/assistant/prompt', (req, res) => {
  state.user_message = req.body.user_message;
  return sendDelta(res, `assistant got prompt ${state.user_message}`, { user_message: state.user_message });
});
app.post('/api/assistant/run', (req, res) => {
  return sendDelta(res, 'assistant run stub', {});
});
app.post('/api/assistant/search_web', (req, res) => {
  return sendDelta(res, 'assistant search_web stub', {});
});
app.post('/api/assistant/run_code', (req, res) => {
  return sendDelta(res, 'assistant run_code stub', {});
});
app.post('/api/assistant/assistant', (req, res) => {
  return sendDelta(res, 'create assistant stub', {});
});
app.post('/api/assistant/thread', (req, res) => {
  return sendDelta(res, 'create thread stub', {});
});

// =========================
// agent routes
// =========================

app.post('/api/agent/get_vector_store', (req, res) => {
  return sendDelta(res, 'agent get_vector_store stub', {});
});
app.post('/api/agent/create_vector_store', (req, res) => {
  return sendDelta(res, 'agent create_vector_store stub', {});
});
app.post('/api/agent/prompt', (req, res) => {
  state.user_message = req.body.user_message;
  return sendDelta(res, `agent got prompt ${state.user_message}`, { user_message: state.user_message });
});
app.post('/api/agent/run', (req, res) => {
  return sendDelta(res, 'agent run stub', {});
});
app.post('/api/agent/search_web', async (req, res) => {
  // example: immediate search
  state.tools.push({ type: 'web_search_preview' });
  return sendDelta(res, 'agent web_search enabled', { tools: state.tools });
});
app.post('/api/agent/run_code', (req, res) => {
  return sendDelta(res, 'agent run_code stub', {});
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
