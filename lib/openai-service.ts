import OpenAI from 'openai';

export interface LeadData {
    visitor_name: string | null;
    visitor_email: string | null;
    visitor_phone: string | null;
    tldr_summary: string;
    top_questions: string[];
    objections: string[];
    intent_signals: string[];
    pain_points: string[];
    lead_score: number;
    suggested_follow_up_draft: string;
    visitor_recap_message: string;
    tailor_made_sales_plan: string;
    crm_action_plan: string;

    // B2B Insights
    inquiry_type: string;
    current_infrastructure: string;
    product_details: string;
    budget: string;
    timeline: string;
    competitors_or_blockers: string[];
    qualification_status: string;
    agent_action: string;
    recommended_next_steps: string[];
}

export class LLMService {
    private client: OpenAI;
    private provider: 'openai' | 'nvidia' | 'local';
    private model: string;

    constructor() {
        // Priority: 1. NVIDIA (Free/High-Perf) -> 2. Local (5080) -> 3. OpenAI (Paid)
        if (process.env.NVIDIA_API_KEY) {
            console.log('[LLMService] Initializing with NVIDIA Build API (Hermes-capable)');
            this.client = new OpenAI({
                apiKey: process.env.NVIDIA_API_KEY,
                baseURL: 'https://integrate.api.nvidia.com/v1'
            });
            this.provider = 'nvidia';
            this.model = 'meta/llama-3.1-70b-instruct'; // Powerful model for extraction
        } else if (process.env.LOCAL_LLM_URL) {
            console.log(`[LLMService] Initializing with Local 5080 at ${process.env.LOCAL_LLM_URL}`);
            this.client = new OpenAI({
                apiKey: 'local-5080',
                baseURL: process.env.LOCAL_LLM_URL
            });
            this.provider = 'local';
            this.model = process.env.LOCAL_LLM_MODEL || 'llama3';
        } else {
            console.log('[LLMService] Initializing with OpenAI API');
            this.client = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
            this.provider = 'openai';
            this.model = 'gpt-4o';
        }
    }

    async analyzeTranscript(
        transcriptText: string,
        agentName: string = 'the Agent',
        options?: { model?: string; provider?: 'openai' | 'nvidia' | 'local' }
    ): Promise<LeadData | null> {
        const activeProvider = options?.provider || this.provider;
        const activeModel = options?.model || this.model;

        console.log(`[LLMService] Starting transcript analysis using ${activeProvider} (${activeModel})...`);

        const systemPrompt = `
You are an expert Sales Intelligence Analyst evaluating a conversation between ${agentName} (an AI Technical Agent) and a website visitor.
Your job is to read the raw transcript and extract exactly these data points as strict JSON.

# SCHEMA RULES
Output exactly this JSON structure. Do not include markdown formatting or \`\`\`json wrappers.
{
  "visitor_name": "Extract the visitor's name or company name if mentioned, otherwise null.",
  "visitor_email": "Extract the visitor's email address if they provided one, otherwise null.",
  "visitor_phone": "Extract the visitor's phone if provided, otherwise null.",
  "tldr_summary": "A 1-2 sentence high-level summary of who the user is and what they wanted.",
  "top_questions": ["What is an X Agent?", "How much does it cost?"],
  "objections": ["Worried about hallucination risk", "Not sure it fits their industry"],
  "intent_signals": ["Asked for a demo link", "Discussed a specific timeline", "Mentioned a current vendor they dislike"],
  "pain_points": ["Current chatbots are dumb", "Lead routing is too slow"],
  "lead_score": 7, // Integer from 1 (low) to 10 (high) based on buying readiness
  "suggested_follow_up_draft": "Draft a short email for a human rep to send to the user based on their specific needs. Do not wrap this draft in quotation marks.",
  "visitor_recap_message": "Draft a warm, consultative 'thank you' message to the user recapping their main points. MUST use text bullet points (starting with dashes or dots) to clearly list specific details they shared. Do not use HTML tags.",
  "tailor_made_sales_plan": "A detailed, step-by-step strategic approach for the human rep to close this deal. Reference specific pain points, known budget/timelines, and suggest the exact value proposition to lean into.",
  "crm_action_plan": "A bulleted or numbered list of exactly what data should be entered into the CRM (e.g. 'Set primary objection to X', 'Update deal size to Y', 'Set follow-up task for Date').",
  "inquiry_type": "Classify accurately (e.g., General, Support, Hardware, AI).",
  "current_infrastructure": "Detail exactly what they are currently using, replacing or integrating with.",
  "product_details": "List EVERY specific piece of software, service, or product mentioned.",
  "budget": "Extract budget details if any.",
  "timeline": "Target deployment or decision timeline.",
  "competitors_or_blockers": ["Any mentioned competitors or blockers."],
  "qualification_status": "e.g., Qualified - Hot, Unqualified, Needs Review",
  "agent_action": "What actions did the agent take during the call?",
  "recommended_next_steps": ["Specific actionable steps for the sales team."]
}

# EXTRACTION RULES
- If a data point is missing or not mentioned, return an empty array [] or null/empty string.
- **PHONETIC NORMALIZATION (CRITICAL)**: AI voice transcripts often contain spelled-out contact info (e.g., "r v i k s at gmail dot com"). You MUST normalize these:
    - visitor_email: Remove ALL spaces. Convert "at" to "@". Convert "dot" to ".". Ensure it is a valid email format.
    - visitor_phone: Convert to numeric format only (e.g., "+15550001234").
    - visitor_name: Capitalize correctly and remove repetitive spelled-out letters.
- The lead_score should be 1-3 for casual curiosity, 4-7 for specific use cases, and 8-10 for explicit demo requests or quotes.
- The visitor_recap_message should be written from the perspective of ${agentName} thanking them for the chat.
`;

        try {
            const response = await this.client.chat.completions.create({
                model: activeModel,
                response_format: activeProvider === 'openai' ? { type: "json_object" } : undefined,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Here is the transcript to analyze:\n\n${transcriptText}` }
                ],
                temperature: 0.1,
            });

            const content = response.choices[0].message.content;
            if (!content) return null;

            const cleanJson = content.replace(/```json\n?|\n?```/g, '').trim();
            return JSON.parse(cleanJson) as LeadData;

        } catch (error) {
            console.error(`[LLMService] Analysis failed on ${activeProvider}:`, error);
            return null;
        }
    }
}
