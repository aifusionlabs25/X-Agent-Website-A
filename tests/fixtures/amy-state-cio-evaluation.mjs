// Visitor turns from 76ae1051, with the misheard spoken name removed.
export const stateCioEvaluationTurns = [
    "I've been thinking about how to build better public-sector client experiences while keeping our sales teams effective. What's your role in something like that?",
    'All right, so you help at the front end.',
    'If I gave you an example, could you show me how that would work?',
    "Let's say I'm a state CIO coming in with a complex modernization request. How would you guide that conversation so my team ends up with something useful?",
    'That makes sense. Could you show me what that working brief would look like after such a conversation so I can see it in action?',
    "Yes, show me that. I'd like to see what it looks like when it's captured.",
    "I see the working brief. Let's say I want to clarify a detail. Can this be updated if something changes?",
    "Let's say the CIO updates the timeline. Can you adjust the brief to reflect a new deadline?",
    "Let's say the deadline moves up by a month. Adjust the timeline forward by 30 days. Can you show that now?",
    "Let's assume the original deadline was six months out. Move it up so it's now five months out from today.",
    "Let's set the new deadline exactly five months from today. That will be the timeline to capture.",
    "Let's be specific. Set the deadline to February 2nd, 2027. That's exactly five months from today's date.",
    "Since the adjustment didn't take, I'll leave that detail for later. This was a helpful overview. I'm set for now. Thanks, Amy. Have a great day.",
].map(content => ({ role: 'user', content }));
