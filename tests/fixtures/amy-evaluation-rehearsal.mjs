// Sanitized visitor replay from 536e14b9. No private contact or real identity data.
export const evaluationTurns = [
    "She's starting it.",
    "Hi Amy, I'm an evaluator. Rob asked me to check this out so I'm here to see what we can do.",
    'Do? Tell me a bit about what you are.',
    'Okay, so you handle the front end of the conversation. How exactly would that help my team?',
    "All right, that's interesting. Show me what one of these briefs looks like. What would I actually see after that conversation?",
    "That's helpful. So this brief would go to one of my specialists before they meet with the client.",
    'That makes sense.',
    "One more thing, what happens if a client asks you something you can't or shouldn't answer?",
    "All right, that's good to know. I'm set for now. Could you send me the summary of what we've gone over so I can review later?",
    "That's all I needed to do. Thanks, Amy. Take care.",
].map(content => ({ role: 'user', content }));
