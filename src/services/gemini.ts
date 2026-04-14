import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateFlashcards(topic: string, count: number = 5) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Generate ${count} flashcards about the following topic: ${topic}. 
    Provide clear, concise questions and accurate answers.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: {
              type: Type.STRING,
              description: "The question or concept name.",
            },
            answer: {
              type: Type.STRING,
              description: "The answer or explanation.",
            },
            type: {
              type: Type.STRING,
              enum: ["theory", "question"],
              description: "Whether this is a theoretical concept or a practice question.",
            },
            options: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "If type is 'question', provide 4 multiple choice options. Include the correct answer as one of the options."
            },
          },
          required: ["question", "answer", "type"],
        },
      },
    },
  });

  try {
    const jsonStr = response.text.trim();
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Failed to parse Gemini response:", error);
    return [];
  }
}

export async function chatWithAssistant(message: string, history: { role: 'user' | 'model', parts: { text: string }[] }[]) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    systemInstruction: `You are the NEET Prep AI Assistant. Your goal is to help users create high-quality study decks for the NEET exam.
      You can discuss topics, explain concepts, and suggest flashcard ideas.
      When the user is ready to create a deck, you should provide a JSON response containing the deck title, description, and a list of flashcards.
      
      Format for creating a deck:
      {
        "type": "create_deck",
        "title": "Deck Title",
        "description": "Deck Description",
        "cards": [
          { "question": "...", "answer": "..." }
        ]
      }
      
      If you are just chatting, respond with plain text. If you are proposing a deck, include the JSON block.`,
    contents: [...history, { role: 'user', parts: [{ text: message }] }],
  } as any);

  return response.text;
}

export async function analyzeDocumentAndGenerateCards(content: string, syllabus: any) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze the following document content and generate flashcards. 
    Segregate the flashcards into the appropriate subtopics from the provided syllabus.
    
    Syllabus: ${JSON.stringify(syllabus)}
    
    Document Content: ${content.substring(0, 10000)}
    
    For each card, provide:
    1. The question or concept name.
    2. The answer or explanation.
    3. The type ("theory" or "question").
    4. The subject ("Biology", "Physics", or "Chemistry").
    5. The subtopic (must be exactly one of the strings from the syllabus arrays).`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            answer: { type: Type.STRING },
            type: { type: Type.STRING, enum: ["theory", "question"] },
            options: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING },
              description: "If type is 'question', provide 4 multiple choice options. Include the correct answer as one of the options."
            },
            subject: { type: Type.STRING, enum: ["Biology", "Physics", "Chemistry"] },
            subtopic: { type: Type.STRING },
          },
          required: ["question", "answer", "type", "subject", "subtopic"],
        },
      },
    },
  });

  try {
    const jsonStr = response.text.trim();
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Failed to parse Gemini response:", error);
    return [];
  }
}
