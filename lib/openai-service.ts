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

export class OpenAIService {
    private openai: OpenAI;

    constructor() {
        if (!process.env.OPENAI_API_KEY) {
            console.warn('[OpenAI] Missing API Key. Analysis will fail.');
        }
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }

    async analyzeTranscript(transcriptText: string, agentName: string = 'the Agent'): Promise<LeadData | null> {
        console.log('[OpenAI] Starting transcript analysis...');

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
  "visitor_recap_message": "Draft a short, warm, consultative 'thank you' message to the user recapping their main points. Keep it professional.",
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
- The lead_score should be 1-3 for casual curiosity, 4-7 for specific use cases, and 8-10 for explicit demo requests or quotes.
- The visitor_recap_message should be written from the perspective of ${agentName} thanking them for the chat.
`;

        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o", // Strongest model for strict JSON output
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Here is the transcript to analyze:\n\n${transcriptText}` }
                ],
                temperature: 0.1,
            });

            const content = response.choices[0].message.content;
            if (!content) return null;

            return JSON.parse(content) as LeadData;

        } catch (error) {
            console.error('[OpenAI] Analysis failed:', error);
            return null;
        }
    }
}
