import fs from 'node:fs';
import {createHash} from 'node:crypto';
const dir=new URL('../../.vercel/comparison/',import.meta.url);
const sha=s=>createHash('sha256').update(s).digest('hex');
const baseline=fs.readFileSync(new URL('baseline-prompt.txt',dir),'utf8');
const changes=[
 ['Use conversation_guidance to advance the current stage. Obey greeting_allowed=false and completed_intents_do_not_reask: never replay a greeting or ask a resolved question.',
  'Conduct a useful natural intake using the conversation history. Recognize supplied answers and choose a genuinely useful next question. Verified tool results govern saved facts, pending confirmations and action status. Never replay a greeting or ask a resolved question.'],
 ['If completion_language_allowed is false, do not say “that\'s all the information I need”, “we can wrap up”, “otherwise I\'ll say goodbye”, or offer a final summary. Ask its next useful question once, without narrating the tool.',
  'When handoff_readiness.ready is false, do not claim the intake is complete or offer a final summary. Readiness can indicate missing information without forcing repeated questions or preventing visitor exit.'],
 ['Ask the next missing high-value item naturally, one question at a time, using the returned current fields and conversation_guidance. Proceed as understand → clarify → contact → requested outcome → open-items check → handoff.',
  'Use the conversation history and verified current fields to choose a genuinely useful next question, if one is needed. Missing-field information does not prescribe a mandatory conversational sequence.'],
 ['Follow the returned missing-item guidance.',
  'Use returned readiness information to understand remaining gaps without re-asking supplied answers.'],
];
let prompt=baseline;
for(const [before,after] of changes){if(prompt.split(before).length!==2)throw Error('Prompt replacement is not unique');prompt=prompt.replace(before,after);}
if(/conversation_guidance|completion_language_allowed|next_question|Proceed as understand/.test(prompt))throw Error('Planner dependency remains');
fs.writeFileSync(new URL('neutral-prompt.txt',dir),prompt,{flag:'wx'});
fs.writeFileSync(new URL('prompt-diff.json',dir),JSON.stringify({baselineHash:sha(baseline),commonPromptHash:sha(prompt),changes},null,2),{flag:'wx'});
console.log(JSON.stringify({baselineHash:sha(baseline),commonPromptHash:sha(prompt),changedSpans:changes.length}));
