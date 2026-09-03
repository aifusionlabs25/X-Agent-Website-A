import type { AmyWorkbenchFactChange, AmyWorkbenchModel, AmyWorkbenchView } from './workbench-v2.ts';

export interface AmyVisibleRoadmapReceipt {
    title: string | null;
    outcome: string | null;
    facts: Array<{ label: string; value: string }>;
    phases: Array<{ number: string; title: string; detail: string }>;
    complete: boolean;
}

const VIEW_NAME: Record<AmyWorkbenchView, string> = {
    capabilities: 'capability overview',
    notes: 'working notes',
    brief: 'working brief',
    roadmap: 'working roadmap',
    visual: 'working visual brief',
    catalog: 'directional catalog',
};

/** Copy only fields that the roadmap renderer actually displays; never summarize them. */
function visibleRoadmap(model: AmyWorkbenchModel): AmyVisibleRoadmapReceipt {
    let remainingSerializedCharacters = 9_000;
    let complete = model.roadmap.phases.length <= 8;
    const accept = (value: string, maximum: number) => {
        const serializedLength = JSON.stringify(value).length;
        if (value.length > maximum || serializedLength > remainingSerializedCharacters) {
            complete = false;
            return false;
        }
        remainingSerializedCharacters -= serializedLength;
        return true;
    };
    const title = accept(model.roadmap.title, 300) ? model.roadmap.title : null;
    const outcome = accept(model.roadmap.outcome, 1_500) ? model.roadmap.outcome : null;
    // AmyAnamWorkbenchV2 renders the first seven fact chips, but all phases.
    const facts = model.roadmap.facts.slice(0, 7)
        .filter((fact) => accept(fact.label, 120) && accept(fact.value, 500))
        .map(({ label, value }) => ({ label, value }));
    const phases = model.roadmap.phases.slice(0, 8)
        .filter((phase) => accept(phase.number, 12) && accept(phase.title, 180) && accept(phase.detail, 800))
        .map(({ number, title: phaseTitle, detail }) => ({ number, title: phaseTitle, detail }));
    return { title, outcome, facts, phases, complete };
}

/** The input must be the same conversation-grounded model committed to the view. */
export function buildAmyWorkbenchReceiptDetails(
    model: AmyWorkbenchModel,
    view: AmyWorkbenchView,
    appliedChanges: AmyWorkbenchFactChange[],
) {
    const roadmap = view === 'roadmap' ? visibleRoadmap(model) : undefined;
    const supportedChanges = appliedChanges.filter((change) => {
        const current = model.facts.find((fact) => fact.section === change.section && fact.label === change.label);
        return change.kind === 'removed' ? !current : current?.value === change.value;
    });
    const subject = `The ${VIEW_NAME[view]}`;
    const sampleDeadline = model.evaluationSample?.facts.find(fact => fact.label === 'Illustrative revised deadline')?.value;
    const sampleDeadlineChanged = appliedChanges.some(change => change.label === 'Illustrative revised deadline');
    const currentSampleFacts = new Map((model.evaluationSample?.facts ?? []).map(fact => [fact.label, fact.value]));
    const visibleSampleChanges = appliedChanges
        .filter(change => change.kind !== 'removed' && currentSampleFacts.get(change.label) === change.value)
        .slice(0, 2);
    const sampleChangeConfirmation = visibleSampleChanges.length
        ? `The fictional sample brief now shows ${visibleSampleChanges.map((change) => {
            const label = change.label.replace(/^Illustrative\s+/i, '').toLowerCase();
            return `${change.value} as its ${label}`;
        }).join(' and ')}; it is not customer data.`
        : null;
    const spokenConfirmation = model.conversationKind === 'evaluation'
        ? view === 'visual'
            ? sampleDeadlineChanged && sampleDeadline
                ? `The fictional sample brief now shows ${sampleDeadline} as its illustrative deadline. It is not customer data.`
                : sampleChangeConfirmation
                    ? sampleChangeConfirmation
                : 'The fictional sample brief is open. It illustrates the format, not a real customer or completed handoff.'
            : 'The evaluation view is open; it describes this demo discussion, not a customer opportunity.'
        : supportedChanges.length === 0
        ? `${subject} is open; I checked it, but no supported facts changed.`
        : model.quality.level === 'developing' || roadmap?.complete === false
        ? `${subject} is open, with details still to clarify.`
        : `${subject} is open for review.`;
    return {
        spokenConfirmation,
        ...(roadmap ? { visibleRoadmap: roadmap } : {}),
    };
}
