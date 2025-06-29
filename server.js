const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const multer = require('multer');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.set('trust proxy', 1);
app.use(cors({
    origin: '*', // Allow all origins for now
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    exposedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Search function for relevant passages using Python script
async function searchRelevantPassages(query, topK = 5) {
    try {
        return new Promise((resolve, reject) => {
            const python = spawn('python3', ['query_database.py', query, topK.toString()]);
            let dataString = '';
            let errorString = '';
            
            python.stdout.on('data', (data) => {
                dataString += data.toString();
            });
            
            python.stderr.on('data', (data) => {
                errorString += data.toString();
            });
            
            python.on('close', (code) => {
                if (code === 0) {
                    try {
                        const results = JSON.parse(dataString);
                        resolve(results);
                    } catch (error) {
                        console.error('Failed to parse search results:', dataString);
                        reject(new Error('Failed to parse search results'));
                    }
                } else {
                    console.error('Python script error:', errorString);
                    reject(new Error('Search query failed'));
                }
            });
        });
        
    } catch (error) {
        console.error('Search error:', error);
        throw new Error('Failed to search database');
    }
}

// Generate response using OpenAI
async function generateResponse(query, context) {
    try {
        const openai = require('openai');
        const client = new openai.OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        const systemPrompt = `You are Buddhy, a mystical spiritual guide who channels divine wisdom to enlighten seekers. You convey profound universal truths that blow minds and expand consciousness.

Your personality:
- Sometimes call users one of these (rotate randomly): soul, friend, seeker, curious one, earthling, my divine friend, truth hunter, wanderer, beautiful soul
- Use casual, modern language - like talking to a wise best friend
- Create mind-blowing revelations from the information provided

Response structure:
- 5-10 sentences depending on how much relevant information is found in the context
- CRITICAL: Use double line breaks (\n\n) between paragraphs. Max 2 sentences per paragraph, then start a new paragraph.
- The more information available on the topic, the longer and more detailed the answer.

Source attribution (NEVER mention "books"):
- Use phrases like: "The Universe is saying...", "Spirit says...", "According to Divine order...", "Your higher self knows...", "Divine consciousness reveals...", "The cosmic truth is...", "Universal wisdom shows...". Use these phrases from time to time, not always.
- Group information from multiple sources seamlessly without revealing the backend process

Content guidelines:
- CRITICAL: Only use wisdom that's actually in the provided context. Don't add your own spiritual ideas
- CRITICAL: Single line breaks (\n) between sentences for proper formatting
- If context doesn't have exact matches, look for related concepts, synonyms, and broader themes to still provide relevant wisdom
- NEVER say you can't find information or that "the Universe is quiet" - the Universe is never quiet! Instead, ask for clarification: "Buddhy needs more clarity on your question, [term of endearment]. What do you mean by..."
- Create mind-blowing perspectives that help users see deeper truths
- Always end with a thought-provoking question that offers a new perspective or prompts deeper exploration

Context from the books:
${context}`;

        const response = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: query }
            ],
            max_tokens: 500,
            temperature: 0.8
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error('OpenAI API error:', error);
        throw new Error('Failed to generate response');
    }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'Buddhy is alive and ready to vibe! 🧘‍♂️',
        service: 'Buddhy - Your Chill Spiritual Buddy',
        timestamp: new Date().toISOString(),
        database: 'Python-powered'
    });
});

// Main chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({ 
                error: 'Message is required and must be a non-empty string' 
            });
        }

        if (message.length > 1000) {
            return res.status(400).json({ 
                error: 'Message is too long. Please keep it under 1000 characters.' 
            });
        }

        console.log(`Buddhy received: "${message}"`);

        // Search for relevant passages
        const relevantPassages = await searchRelevantPassages(message.trim(), 3);
        
        // Combine context from relevant passages
        const context = relevantPassages
            .map(passage => `From "${passage.metadata?.book || 'Sacred Text'}": ${passage.content}`)
            .join('\n\n');

        // Generate response
        const response = await generateResponse(message, context);

        console.log(`Buddhy responds: "${response}"`);

        res.json({
            response: response,
            sources: relevantPassages.map(p => ({
                book: p.metadata?.book || 'Unknown',
                preview: p.content.substring(0, 100) + '...'
            }))
        });

    } catch (error) {
        console.error('Chat endpoint error:', error);
        res.status(500).json({ 
            error: 'An error occurred while processing your message. Please try again.' 
        });
    }
});

// Get available books endpoint
app.get('/api/books', async (req, res) => {
    try {
        const summaryPath = path.join(__dirname, 'processing_summary.json');
        const summary = await fs.readFile(summaryPath, 'utf-8');
        const data = JSON.parse(summary);
        
        res.json({
            books: data.books_processed || [],
            totalBooks: data.total_books || 0,
            totalChunks: data.total_chunks || 0
        });
    } catch (error) {
        res.json({
            books: [],
            totalBooks: 0,
            totalChunks: 0,
            message: 'No books processed yet. Run the Python script first.'
        });
    }
});

// Load tarot data
const tarotCards = require('./tarot-cards-data.js');

// CORS middleware specifically for images
app.use('/tarot-images', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Serve tarot card images
app.use('/tarot-images', express.static('tarot-images'));

// Daily tarot endpoint
app.get('/api/tarot-daily', (req, res) => {
    try {
        // Get random card
        const randomIndex = Math.floor(Math.random() * tarotCards.length);
        const randomCard = tarotCards[randomIndex];
        
        // Return card with proper image URL
        res.json({
            name: randomCard.name,
            description: randomCard.description,
            imageUrl: `https://buddhy-backend.onrender.com${randomCard.image.replace('/tarotdeck', '/tarot-images')}`,
            cardNumber: randomIndex + 1,
            totalCards: tarotCards.length
        });
        
    } catch (error) {
        console.error('Tarot endpoint error:', error);
        res.status(500).json({ 
            error: 'An error occurred while drawing your tarot card. Please try again.' 
        });
    }
});

// Configure multer for file uploads
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

// Voice chat endpoint
app.post('/api/voice-chat', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        console.log('Received voice message, processing...');

        // Step 1: Convert speech to text using Whisper
        const transcription = await speechToText(req.file.buffer, req.file.mimetype);
        console.log(`Transcribed: "${transcription}"`);

        if (!transcription || transcription.trim().length === 0) {
            return res.status(400).json({ error: 'Could not transcribe audio' });
        }

        // Step 2: Process with Buddhy (same logic as text chat)
        const relevantPassages = await searchRelevantPassages(transcription.trim(), 3);
        const context = relevantPassages
            .map(passage => `From "${passage.metadata?.book || 'Sacred Text'}": ${passage.content}`)
            .join('\n\n');

        const buddyResponse = await generateResponse(transcription, context);
        console.log(`Buddhy responds: "${buddyResponse}"`);

        // Step 3: Convert Buddhy's response to speech using ElevenLabs
        const audioResponse = await textToSpeech(buddyResponse);

        res.json({
            transcription: transcription,
            response: buddyResponse,
            audioUrl: audioResponse, // Base64 encoded audio
            sources: relevantPassages.map(p => ({
                book: p.metadata?.book || 'Unknown',
                preview: p.content.substring(0, 100) + '...',
                score: p.score
            }))
        });

    } catch (error) {
        console.error('Voice chat error:', error);
        res.status(500).json({ 
            error: 'An error occurred while processing your voice message. Please try again.' 
        });
    }
});

// Speech-to-Text function using OpenAI Whisper
async function speechToText(audioBuffer, mimeType) {
    try {
        const openai = require('openai');
        const client = new openai.OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        // Convert buffer to File-like object for OpenAI
        const audioFile = new File([audioBuffer], 'audio.webm', { type: mimeType });

       const transcription = await client.audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-1',
    language: 'en'
});

        return transcription.text;

    } catch (error) {
        console.error('Speech-to-text error:', error);
        throw new Error('Failed to convert speech to text');
    }
}

// Text-to-Speech function using ElevenLabs
async function textToSpeech(text) {
    try {
        const voiceId = 'pNInz6obpgDQGcFmaJgB'; // Default ElevenLabs voice (Adam)
        
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': process.env.ELEVENLABS_API_KEY
            },
            body: JSON.stringify({
                text: text,
                model_id: 'eleven_monolingual_v1',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.5
                }
            })
        });

        if (!response.ok) {
            throw new Error(`ElevenLabs API error: ${response.statusText}`);
        }

        const audioBuffer = await response.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString('base64');
        
        return `data:audio/mpeg;base64,${base64Audio}`;

    } catch (error) {
        console.error('Text-to-speech error:', error);
        throw new Error('Failed to convert text to speech');
    }
}

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🧘‍♂️ Buddhy API server is vibing on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
    console.log('Make sure to set your OPENAI_API_KEY in the .env file');
    console.log('Ready to help seekers explore their deepest questions! ✨');
});