// User-only replay of f00c3743. Name anonymized; uncertain ASR is intentionally preserved.
export const securityTurns = [
    "Hi Amy, I'm Demo Visitor. I need to figure out how to align our infrastructure modernisation with a security compliance deadline.",
    "We have a state mandated audit due in 90 days. It's aligned with NIST controls and our current setup isn't fully compliant.",
    "I'll see if Demo Visitor agrees with the decision. We have a recent GAP assessment showing outdated encryption and some privileged access issues.",
    'The encryption gap ties to the system and communications protection family and the privileged access gap is in access control.',
    'The encryption gap affects all external facing systems around 15. The privileged access issue is more focused on admin accounts, fewer systems but critical.',
    "Our CISOs team will own both, but they'll likely assign a need for each. We haven't finalised that yet.",
    "It's TLS 1.2 minimum. We confirmed that in the last review.",
    'Yes, a phased road map would help to clarify how we track both in parallel.',
    'This looks solid. Could you email me that summary so I can review it with the team?',
    'No, that covers everything for now. Thanks for your help Amy. Take care.',
].map(content => ({role:'user', content}));
