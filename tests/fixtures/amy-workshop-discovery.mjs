// Anonymized visitor-only replay of the September 2 cloud/AI workshop test.
export const workshopTurns = [
    "I'd like to figure out if our cloud migration and the AI use case we're considering should be tackled together or separately.",
    'And not slowing down either effort. Leadership wants both done this fiscal year.',
    "We're in a hybrid setup, some workloads on-prem, some already in Azure. The AI use case is mainly about case management, streamlining workflows, pulling from our existing data in SharePoint and our on-prem SQL.",
    "Our IT infrastructure team owns that call, but they'll need input from the business side to weigh the AI use case timing.",
    "Not fully, we've got a rough outline of case types, process pain points, but no finalised requirements. We need that shaped quickly.",
    'Yes, a clear map would help. We need to know the key data inputs, the business outcomes they expect and any compliance constraints.',
    "Let's aim to set the workshop within the next two weeks. That gives us time to finalise requirements before the infrastructure team locks anything in.",
    'That roadmap looks good. Could you email me the summary so I can share it with leadership?',
    'No, that covers what I needed. Thanks for walking me through it. Take care.',
].map(content => ({ role: 'user', content }));
