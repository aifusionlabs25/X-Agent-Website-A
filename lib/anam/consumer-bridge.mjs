// Local integration candidate only. No HTTP client, storage backend or action tools.
// The server/caller must own the prior accepted state; never accept it from a model.
import {createHash} from 'node:crypto';
import {prepareCaptureContract, applyCaptureSnapshot, projectCaptureState}
 from './capture/capture-state-contract.mjs';
import {projectEvanCapturePlan, projectEvanCaptureIntake}
 from './capture/evan-capture.ts';

export const candidate = 'f04d8728aea5cc6d3339cc73d4cb2a23ac96c15bb50b17ba0a6b0b797e012cca';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => structuredClone(value);
const sameBinding = (a,b) => a && Object.keys(a).sort().join(',') === Object.keys(b).sort().join(',')
 && Object.keys(b).every(key => a[key] === b[key]);

export function prepareConsumerCapture({sessionKey, role, turns, revision, previousState = null}) {
 if (typeof sessionKey !== 'string' || !/^synthetic-[\w-]{1,100}$/.test(sessionKey))
  throw new Error('LOCAL_SYNTHETIC_SESSION_REQUIRED');
 const context = clone({role, turns, revision}), prior = clone(previousState);
 const prepared = prepareCaptureContract({...context, previousState: prior});
 const binding = {sessionKey, candidate, role, revision, sourceHash: digest(context.turns),
  previousStateHash: digest(prior)};
 return {
  binding: clone(binding),
  request: {instructions: prepared.instructions, input: clone(prepared.input), schema: clone(prepared.schema)},
  accept(response) {
   if (!response || Object.keys(response).sort().join(',') !== 'binding,wire'
       || !sameBinding(response.binding, binding)) throw new Error('CAPTURE_RESPONSE_BINDING_MISMATCH');
   // Managed service wire MUST pass accept(), preserving the source-lookup receipt.
   // Other wire passes the same authoritative state validator; no repairs here.
   const accepted = prepared.serviceReferenceMode ? prepared.accept(clone(response.wire)) : (() => {
    const payload = prepared.restore(clone(response.wire));
    return {state: applyCaptureSnapshot(prior, payload, context), receipt: null};
   })();
   const state = accepted.state, projection = projectCaptureState(state);
   const plan = role === 'moving' ? projectEvanCapturePlan(state.record) : null;
   const intake = role === 'moving' ? projectEvanCaptureIntake(state.record) : null;
   const review = {
    status: 'UNSUBMITTED_CAPTURE_REVIEW', contact: projection.contact,
    collection: projection.collection, confirmationNeeded: projection.confirmationNeeded,
    mayAskContact: projection.mayAskContact, clientQuestions: projection.clientQuestions,
    plan, intake,
    // This flag is role applicability, not completed intake or permission to act.
    roleApplicability: role === 'moving' ? 'MOVING_PROJECTIONS_SUPPORTED' : 'CONTACT_ONLY_ROLE_REVIEW_REQUIRED',
    handoffReadiness: 'NOT_EVALUATED', handoffAuthority: 'NONE', ownerApproval: 'NOT_GRANTED',
    emailSendAllowed: false, actionAuthority: 'NONE',
   };
   return {schema: 'capture-consumer-integration.v0.1', binding: clone(binding),
    capture: state.record, captureState: state, sourceDigest: state.sourceHash,
    serviceReferenceReceipt: accepted.receipt, acceptedStateHash: digest(state),
    review, reviewHash: digest(review)};
  },
 };
}

// Pure replay of an audit artifact, not a database, server authentication or a
// signature. expectedHash must come from a separately retained local manifest.
export function reloadLocalCheckpoint(checkpoint, expectedHash) {
 if (digest(checkpoint) !== expectedHash) throw new Error('CHECKPOINT_INTEGRITY_MISMATCH');
 const prepared = prepareConsumerCapture(checkpoint.input);
 const result = prepared.accept(checkpoint.response);
 if (digest(result) !== digest(checkpoint.result)) throw new Error('CHECKPOINT_REPLAY_MISMATCH');
 return result;
}
