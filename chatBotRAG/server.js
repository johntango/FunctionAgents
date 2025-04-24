import express from 'express';
import bodyParser from 'body-parser';
import { OpenAI} from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from "fs";
import { start } from 'repl';

// Initialize Express server
const app = express();
app.use(bodyParser.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.resolve(process.cwd(), './public')));

// OpenAI API configuration
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
  let state = {
        agent:false,
        chat_response:true,
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
        tools:[],
        mcp_tools:[],
        parameters: []
      };
// Default route to serve index.html for any undefined routes
app.get('*', (req, res) => {
    res.sendFile(path.resolve(process.cwd(), './public/index.html'));
});
async function getFunctions() {
   
    const files = fs.readdirSync(path.resolve(process.cwd(), "./functions"));
    const openAIFunctions = {};

    for (const file of files) {
        if (file.endsWith(".js")) {
            const moduleName = file.slice(0, -3);
            const modulePath = `./functions/${moduleName}.js`;
            const { details, execute } = await import(modulePath);

            openAIFunctions[moduleName] = {
                "details": details,
                "execute": execute
            };
        }
    }
    return openAIFunctions;
}

// Route to interact with OpenAI API
app.post('/api/execute-function', async (req, res) => {
    const { functionName, parameters } = req.body;

    // Import all functions
    const functions = await getFunctions();

    if (!functions[functionName]) {
        return res.status(404).json({ error: 'Function not found' });
    }

    try {
        // Call the function
        const result = await functions[functionName].execute(...Object.values(parameters));
        console.log(`result: ${JSON.stringify(result)}`);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: 'Function execution failed', details: err.message });
    }
});

app.post('/api/chat_response/get_vector_store', async (req, res) => {
    const { vector_store_name } = req.body;
    try {
        const vectorStores = await openai.vectorStores.list();

        const vectorStore = vectorStores.data.find(store => store.name === vector_store_name);
        if (!vectorStore) {
            return res.status(404).json({ error: 'Vector store not found' });
        }
        // save vector store id to state
        state.vector_store_id = vectorStore.id;

        console.log(`Got ${vectorStore.name} with id ${state.vector_store_id}`);
        res.json({ message:vectorStore.name, state: state });
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve vector store', details: error.message });
    }
});
    
app.post('/api/chat_response/create_vector_store', async (req, res) => {
    let { vector_store_id } = req.body;

    // if the vector store id is not provided, create a new vector store
    if (!vector_store_id) {
        try {
            const vectorStore = await openai.vectorStores.create({
                name: "John Docs",
                description: "John's documents",
                purpose: "vector_store"
            });
            state.vector_store_id = vectorStore.id;
            console.log(`Created ${vectorStore.name}`);
        } catch (error) {
            res.status(500).json({ error: 'Failed to create vector store', details: error.message });
        }
    } else {
        state.vector_store_id = vector_store_id;
    }
    try {
        // Now add files to the vector store
        // get path to chatBotRAG directory
        let dir = path.resolve(process.cwd(), "./RAGData");
        const files = fs.readdirSync(dir);
// strip off the file extension .txt 

        let file_ids = []
        for (const file of files) {
            let response = await openai.files.create({
                    file: fs.createReadStream(path.resolve(dir, file)),
                    purpose: "user_data"
                } );
            
            console.log(`File ${response.id} created`);
            file_ids.push(response.id);
        }
        console.log(`File ids: ${JSON.stringify(file_ids)}`);
    // make vector_store_id a string
        let vec_store_id = String(vector_store_id);
        for (let file_id of file_ids) {
   
            let vector_store = await openai.vectorStores.files.create(
                vec_store_id,
                {"file_id": file_id}
        );
        }

        console.log(`Added files ${file_ids} to vector store ${vector_store_id}`);
        // Now we can use the vector store to search for files


        let response = await openai.responses.create({
            model: "gpt-4o-mini",
            tools: [{
                type: "file_search",
                "vector_store_ids": [vector_store_id],
            }],
            input: "What does John like ?",
        });


        res.json({ message:response.output_text, state: state });
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve vector store', details: error.message });
    }
});
// Example to interact with OpenAI API and get function descriptions
app.post('/api/chat_response', async (req, res) => {
    const { user_message } = req.body;

    const functions = await getFunctions();
    const availableFunctions = Object.values(functions).map(fn => fn.details);
    console.log(`availableFunctions: ${JSON.stringify(availableFunctions)}`);
    let messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: user_message }
    ];
    try {
        let response = await openai.responses.create({
            model: "gpt-4o-mini",
            tools: [{
                type: "file_search",
                "vector_store_ids": [state.vector_store_id],
            }],
            input: messages,
        });

        console.log(`response: ${JSON.stringify(response.output_text)}`);
        res.json({ message:response.output_text, state: state })
    }
    catch (error) {
        console.log(`error: ${JSON.stringify(error)}`);
        res.status(500).json({ error: 'OpenAI API failed', details: error.message });
    }
});

    
        // Make OpenAI API call
        /*
        
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: messages,
            tools: availableFunctions
        });
        
        console.log(`Web Search Example`);
        // Web Search Example
        response = await openai.responses.create({
            model: "gpt-4o",
            tools: [ { type: "web_search_preview" } ],
            input: "What was a positive news story that happened today?",
        });

        console.log(response.output_text);

        console.log(`Web Search Example`);
         // File Search Example
         // get list of files from chatBotRAG 
   
    


        

        console.log(response.output_text);
// Computer Use Example

        response = await openai.responses.create({
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

        console.log(response.output);

        console.log(response.output_text);
      


       // Extract the arguments for get_delivery_date
// Note this code assumes we have already determined that the model generated a function call. See below for a more production ready example that shows how to check if the model generated a function call
        const toolCall = response.choices[0].message.tool_calls[0];

// Extract the arguments for get_delivery_date
// Note this code assumes we have already determined that the model generated a function call. 
        if (toolCall) {
            const functionName = toolCall.function.name;
            const parameters = JSON.parse(toolCall.function.arguments);

            const result = await functions[functionName].execute(...Object.values(parameters));
// note that we need to respond with the function call result to the model quoting the tool_call_id
            const function_call_result_message = {
                role: "tool",
                content: JSON.stringify({
                    result: result
                }),
                tool_call_id: response.choices[0].message.tool_calls[0].id
            };
            // add to the end of the messages array to send the function call result back to the model
            messages.push(response.choices[0].message);
            messages.push(function_call_result_message);
            const completion_payload = {
                model: "gpt-4o",
                messages: messages,
            };
            // Call the OpenAI API's chat completions endpoint to send the tool call result back to the model
            const final_response = await openai.chat.completions.create({
                model: completion_payload.model,
                messages: completion_payload.messages
            });
            // Extract the output from the final response
            let output = final_response.choices[0].message.content 


            res.json({ message:output, state: state });
        } else {
            res.json({ message: 'No function call detected.' });
        }

    } catch (error) {
        res.status(500).json({ error: 'OpenAI API failed', details: error.message });
    }
});
app.post('/api/prompt', async (req, res) => {
    // just update the state with the new prompt
        state.user_message = req.body.user_message;
        res.status(200).json({ message: `got prompt ${state.user_message}`, "state": state });
    
        console.log(error);
        res.status(500).json({ message: 'User Message Failed', "state": state });
    }
)
// Route to interact with OpenAI API
app.post('/api/computeruse', async (req, res) => {
    const { functionName, parameters } = req.body;
    try {
        const response = await openai.responses.create({
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
        console.log(response.output);
        let message = response.output;
        res.json({message: message, state: state});
    } catch (err) {
        res.status(500).json({ error: 'Function execution failed', details: err.message });
    }
});
*/
// Start the server
const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
