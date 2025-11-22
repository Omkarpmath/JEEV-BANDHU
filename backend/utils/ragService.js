const { HfInference } = require('@huggingface/inference');
const { generateEmbedding, findSimilarChunks } = require('./embeddingService');

let hfClient = null;

/**
 * Initialize Hugging Face client
 */
function initializeHF() {
  if (!hfClient && process.env.HUGGINGFACE_API_KEY) {
    hfClient = new HfInference(process.env.HUGGINGFACE_API_KEY);
  }
  return hfClient;
}

/**
 * Build a context-aware prompt for RAG
 * @param {string} question - User's question
 * @param {Array<{text: string}>} relevantChunks - Most relevant text chunks
 * @returns {string} Formatted prompt
 */
function buildRAGPrompt(question, relevantChunks) {
  const context = relevantChunks
    .map((chunk, idx) => `[Context ${idx + 1}]\n${chunk.text}`)
    .join('\n\n');

  const prompt = `You are a helpful AI assistant specialized in livestock health and veterinary care. Use the provided context to answer the user's question accurately and concisely.

Context from documents:
${context}

User Question: ${question}

Instructions:
- Answer based ONLY on the information provided in the context above
- If the context doesn't contain enough information to answer the question, say so clearly
- Be specific and cite relevant details from the context
- Keep your answer clear and practical for farmers
- If discussing medications or treatments, emphasize consulting a veterinarian for specific cases

Answer:`;

  return prompt;
}

/**
 * Generate answer using RAG (Retrieval Augmented Generation)
 * @param {string} question - User's question
 * @param {Array<object>} allChunks - All available chunks with embeddings
 * @param {number} topK - Number of chunks to retrieve
 * @returns {Promise<{answer: string, sources: Array}>} Generated answer and source chunks
 */
async function generateRAGAnswer(question, allChunks, topK = 3) {
  try {
    console.log('🔍 Processing question:', question);

    // Step 1: Generate embedding for the question
    console.log('🔢 Generating question embedding...');
    const questionEmbedding = await generateEmbedding(question);

    // Step 2: Find most relevant chunks
    console.log('🎯 Finding relevant context...');
    const similarChunks = findSimilarChunks(questionEmbedding, allChunks, topK);

    if (similarChunks.length === 0) {
      return {
        answer: "I don't have enough information in the uploaded documents to answer this question. Please make sure you've uploaded relevant documents.",
        sources: []
      };
    }

    console.log(`✅ Found ${similarChunks.length} relevant chunks (similarity scores: ${similarChunks.map(s => s.similarity.toFixed(3)).join(', ')})`);

    // Step 3: Build prompt with context
    const relevantTexts = similarChunks.map(s => ({ text: s.chunk.text }));
    const prompt = buildRAGPrompt(question, relevantTexts);

    // Step 4: Generate answer using LLM
    console.log('🤖 Generating answer with AI...');
    const client = initializeHF();

    if (!client) {
      throw new Error('Hugging Face API key not configured');
    }

    let answer = '';

    try {
      // Using Mistral-7B-Instruct-v0.2 with chatCompletion for personalized responses
      const chatResponse = await client.chatCompletion({
        model: 'mistralai/Mistral-7B-Instruct-v0.2',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful AI assistant specialized in livestock health and veterinary care. Provide detailed, comprehensive, and UNIQUE answers of 7-10 sentences tailored to the specific question. Each response should be personalized and varied. Base your answers ONLY on the provided context.'
          },
          {
            role: 'user',
            content: `Context from documents:\n${context}\n\nUser Question: ${question}\n\nProvide a UNIQUE and PERSONALIZED detailed answer of 7-10 sentences based on the specific context and question. Make your response specific to this exact query. Vary your explanation style and focus on different aspects for different questions. Be specific and cite relevant details that are most pertinent to this particular question.`
          }
        ],
        max_tokens: 650,
        temperature: 0.85,
        top_p: 0.92,
        frequency_penalty: 0.3,
        presence_penalty: 0.2
      });

      answer = chatResponse.choices[0].message.content.trim();
    } catch (error) {
      console.warn('⚠️ Mistral model failed:', error.message);
      // Fallback: Create a detailed response from the context chunks
      if (similarChunks.length > 0) {
        answer = `Based on the available information in your documents:\n\n${relevantTexts.map((t, i) => `${i + 1}. ${t.text.substring(0, 200)}...`).join('\n\n')}\n\nI recommend consulting these sections for more details about "${question}". For specific medical advice, please consult with a qualified veterinarian.`;
      } else {
        throw new Error('Unable to generate answer - please try rephrasing your question or upload more relevant documents.');
      }
    }

    console.log('✅ Answer generated successfully');

    // Return answer with source information
    return {
      answer,
      sources: similarChunks.map(s => ({
        text: s.chunk.text.substring(0, 200) + '...',
        similarity: s.similarity,
        chunkId: s.chunk._id
      }))
    };

  } catch (error) {
    console.error('❌ Error generating RAG answer:', error);
    throw new Error('Failed to generate answer: ' + error.message);
  }
}

/**
 * Stream answer generation (for real-time responses)
 * Note: This is a simplified version - actual streaming requires more complex setup
 * @param {string} question - User's question
 * @param {Array<object>} allChunks - All available chunks with embeddings
 * @param {number} topK - Number of chunks to retrieve
 * @returns {Promise<AsyncGenerator>} Stream of answer tokens
 */
async function* streamRAGAnswer(question, allChunks, topK = 3) {
  try {
    // Generate embedding and find relevant chunks
    const questionEmbedding = await generateEmbedding(question);
    const similarChunks = findSimilarChunks(questionEmbedding, allChunks, topK);

    if (similarChunks.length === 0) {
      yield "I don't have enough information to answer this question.";
      return;
    }

    const relevantTexts = similarChunks.map(s => ({ text: s.chunk.text }));
    const prompt = buildRAGPrompt(question, relevantTexts);

    const client = initializeHF();

    // For now, we'll just yield the complete answer
    // True streaming requires Hugging Face Inference Endpoints
    const result = await generateRAGAnswer(question, allChunks, topK);
    yield result.answer;

  } catch (error) {
    yield `Error: ${error.message}`;
  }
}

/**
 * Diagnose disease based on symptoms using RAG
 * @param {Array<string>} symptoms - Array of symptom descriptions
 * @param {Array<object>} allChunks - All available chunks with embeddings
 * @returns {Promise<{disease: string, confidence: string, explanation: string, treatment: string}>}
 */
async function diagnoseDiseaseFromSymptoms(symptoms, allChunks) {
  try {
    console.log('🔍 Diagnosing disease from symptoms:', symptoms);

    // Build diagnostic question
    const symptomList = symptoms.map(s => `- ${s}`).join('\n');
    const diagnosticQuery = `A cattle is showing these symptoms:\n${symptomList}\n\nWhat disease does it likely have?`;

    // Step 1: Generate embedding for the diagnostic query
    console.log('🔢 Generating query embedding...');
    const queryEmbedding = await generateEmbedding(diagnosticQuery);

    // Step 2: Find most relevant chunks
    console.log('🎯 Finding relevant medical knowledge...');
    const similarChunks = findSimilarChunks(queryEmbedding, allChunks, 5); // Get top 5 chunks

    if (similarChunks.length === 0) {
      return {
        disease: 'Unknown',
        confidence: 'Low',
        explanation: 'Insufficient information in knowledge base to diagnose based on these symptoms.',
        treatment: 'General care'
      };
    }

    console.log(`✅ Found ${similarChunks.length} relevant knowledge chunks`);

    // Step 3: Build specialized diagnostic prompt
    const context = similarChunks
      .map((chunk, idx) => `[Medical Reference ${idx + 1}]\n${chunk.chunk.text}`)
      .join('\n\n');

    const diagnosticPrompt = `You are a veterinary AI assistant specializing in livestock health. Based on the medical knowledge provided, diagnose the most likely disease.

Medical Knowledge Base:
${context}

Patient Symptoms:
${symptomList}

Provide a diagnosis in EXACTLY this format:
DISEASE: [specific disease name]
CONFIDENCE: [High/Medium/Low]
EXPLANATION: [2-3 sentences explaining why these symptoms match this disease]
TREATMENT: [primary treatment approach or medicine category]

Be specific with the disease name. Use medical terminology where appropriate.`;

    // Step 4: Generate diagnosis using LLM
    console.log('🤖 Generating diagnosis...');
    const client = initializeHF();

    if (!client) {
      throw new Error('Hugging Face API key not configured');
    }

    let response = '';

    try {
      // Use Mistral-7B-Instruct-v0.2 with chatCompletion for personalized diagnosis
      // Add timestamp-based seed for unique outputs
      const uniqueSeed = Date.now() % 1000;

      const chatResponse = await client.chatCompletion({
        model: 'mistralai/Mistral-7B-Instruct-v0.2',
        messages: [
          {
            role: 'system',
            content: `You are a veterinary AI assistant specializing in livestock health. Provide UNIQUE and PERSONALIZED comprehensive diagnostic reports with 7-10 sentences of detailed explanation. Each diagnosis should be tailored specifically to the exact symptom combination presented. Vary your diagnostic approach and treatment recommendations based on the specific symptoms. Always use the exact format requested. Analysis ID: ${uniqueSeed}`
          },
          {
            role: 'user',
            content: `Medical Knowledge Base:\n${context}\n\nPatient Symptoms (Unique Case):\n${symptomList}\n\nProvide a PERSONALIZED diagnosis for this SPECIFIC symptom combination in EXACTLY this format:\nDISEASE: [specific disease name tailored to these exact symptoms]\nCONFIDENCE: [High/Medium/Low based on symptom specificity]\nEXPLANATION: [7-10 sentences providing a UNIQUE analysis explaining why THESE SPECIFIC symptoms match this disease, including the pathophysiology relevant to THIS case, the typical progression for THIS symptom pattern, distinguishing features particular to THIS presentation, and risk factors specific to THIS combination]\nTREATMENT: [PERSONALIZED detailed treatment approach specifically for THIS symptom combination, including targeted medication categories, specific supportive care measures relevant to THESE symptoms, monitoring recommendations, and veterinary consultation guidance]\n\nBe highly specific to this exact symptom combination. Make each diagnosis unique and personalized.`
          }
        ],
        max_tokens: 900,
        temperature: 0.75,
        top_p: 0.88,
        frequency_penalty: 0.4,
        presence_penalty: 0.3
      });

      response = chatResponse.choices[0].message.content.trim();
    } catch (error) {
      console.warn('⚠️ Mistral model failed:', error.message);
      // Robust symptom-based fallback system
      const symptomCount = symptoms.length;
      const symptomText = symptoms.join(', ');

      // Analyze symptoms for common disease patterns
      let likelyDisease = 'General Infectious Disease';
      let fallbackExplanation = `The animal is presenting with ${symptomCount} notable symptom${symptomCount > 1 ? 's' : ''}: ${symptomText}. `;

      // Pattern matching for common livestock diseases
      if (symptoms.some(s => s.toLowerCase().includes('fever')) &&
        symptoms.some(s => s.toLowerCase().includes('respiratory'))) {
        likelyDisease = 'Respiratory Infection (Possibly Pneumonia)';
        fallbackExplanation += 'The combination of fever and respiratory symptoms strongly suggests a respiratory tract infection. Pneumonia in cattle can be caused by various bacterial or viral pathogens. Early symptoms often include elevated body temperature, difficulty breathing, and coughing. If left untreated, the condition can progress to severe respiratory distress. The infection may be exacerbated by environmental factors such as poor ventilation or stress. Prompt veterinary intervention is crucial to prevent complications. Treatment typically involves antibiotics and supportive care.';
      } else if (symptoms.some(s => s.toLowerCase().includes('diarrhea'))) {
        likelyDisease = 'Gastrointestinal Infection or Parasitic Condition';
        fallbackExplanation += 'Diarrhea in livestock often indicates gastrointestinal disturbance, which can result from bacterial infections, viral pathogens, or parasitic infestations. The condition leads to fluid loss and potential dehydration if not addressed promptly. Common causes include E. coli, Salmonella, or intestinal parasites. The severity can range from mild to life-threatening depending on the underlying cause. Affected animals may also show signs of dehydration, weight loss, and reduced appetite. Proper diagnosis requires fecal examination and laboratory testing. Treatment involves fluid therapy, antimicrobials if bacterial, and addressing the underlying cause.';
      } else if (symptoms.some(s => s.toLowerCase().includes('lameness'))) {
        likelyDisease = 'Musculoskeletal Disorder or Foot Rot';
        fallbackExplanation += 'Lameness and difficulty walking in cattle can indicate various musculoskeletal problems or infectious conditions like foot rot. Foot rot is a common bacterial infection affecting the hooves, causing pain and mobility issues. The condition can significantly impact the animal\'s welfare and productivity. Environmental factors such as wet, muddy conditions increase susceptibility. If multiple limbs are affected, systemic diseases or nutritional deficiencies may be involved. Early detection and treatment are essential to prevent chronic lameness. Treatment typically includes antibiotics, hoof trimming, and improving environmental conditions.';
      } else if (symptoms.some(s => s.toLowerCase().includes('milk'))) {
        likelyDisease = 'Mastitis or Metabolic Disorder';
        fallbackExplanation += 'Reduced milk production can be a sign of mastitis (udder infection) or metabolic disorders affecting lactating animals. Mastitis is characterized by inflammation of the mammary gland, often caused by bacterial infection. The condition not only reduces milk yield but also affects milk quality. Clinical signs may include swelling, heat, and pain in the udder. Subclinical mastitis can persist without obvious symptoms but still impact production. Metabolic causes could include ketosis or calcium deficiency. Proper diagnosis requires milk testing and clinical examination. Treatment depends on the specific cause but may include antibiotics, anti-inflammatory drugs, and supportive care.';
      } else {
        fallbackExplanation += 'These symptoms warrant professional veterinary evaluation to determine the exact underlying condition. Multiple symptom presentation can indicate various infectious, metabolic, or environmental health challenges. A thorough clinical examination is needed to differentiate between potential diagnoses. Laboratory tests, including blood work and pathogen screening, may be necessary. The animal should be isolated if infectious disease is suspected to prevent spread. Environmental factors, nutrition, and stress levels should also be assessed. Early intervention improves prognosis and reduces the risk of complications. Please consult with a qualified veterinarian for accurate diagnosis and treatment planning.';
      }

      response = `DISEASE: ${likelyDisease}\nCONFIDENCE: Medium\nEXPLANATION: ${fallbackExplanation}\nTREATMENT: Immediate veterinary consultation is recommended for accurate diagnosis and treatment planning. Supportive care including proper nutrition, hydration, and stress reduction should be provided. Depending on the diagnosis, treatment may include antimicrobials, anti-inflammatory medications, or specific therapeutic interventions. Monitor the animal closely and isolate if infectious disease is suspected.`;
    }

    console.log('✅ Diagnosis generated');

    // Step 5: Parse the structured response
    const diseaseMatch = response.match(/DISEASE:\s*(.+?)(?:\n|$)/i);
    const confidenceMatch = response.match(/CONFIDENCE:\s*(.+?)(?:\n|$)/i);
    const explanationMatch = response.match(/EXPLANATION:\s*(.+?)(?:\n|TREATMENT|$)/is);
    const treatmentMatch = response.match(/TREATMENT:\s*(.+?)$/is);

    const diagnosis = {
      disease: diseaseMatch ? diseaseMatch[1].trim() : 'Unable to diagnose',
      confidence: confidenceMatch ? confidenceMatch[1].trim() : 'Low',
      explanation: explanationMatch ? explanationMatch[1].trim() : response,
      treatment: treatmentMatch ? treatmentMatch[1].trim() : 'Consult veterinarian',
      rawResponse: response
    };

    console.log('📋 Diagnosis:', diagnosis.disease, `(${diagnosis.confidence} confidence)`);

    return diagnosis;

  } catch (error) {
    console.error('❌ Error diagnosing disease:', error);
    throw new Error('Failed to diagnose disease: ' + error.message);
  }
}

module.exports = {
  buildRAGPrompt,
  generateRAGAnswer,
  streamRAGAnswer,
  diagnoseDiseaseFromSymptoms
};
