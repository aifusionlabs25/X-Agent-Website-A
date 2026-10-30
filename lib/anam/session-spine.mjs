import {isolatedRuntime} from './isolated-capture-application.mjs';
export {AmyAnamRequestError,EVAN_MULLINS_VARIANT,isUuid,readAmyAnamBrowserSession,readBoundedJsonObject} from './capture/session-spine.ts';
export function readAmyAnamSpineConfig(){const r=isolatedRuntime();return {gatesOpen:Boolean(r),signingSecret:r?.signingSecret??''};}
export function isTrustedBrowserOrigin(request){const r=isolatedRuntime();
 const observed={headerOrigin:request.headers.get('origin'),requestOrigin:new URL(request.url).origin,expectedOrigin:r?.origin};
 if(r?.localDiagnosticTrace)r.localDiagnosticTrace.push(observed);
 return Boolean(r&&observed.headerOrigin===r.origin&&request.headers.get('host')===new URL(r.origin).host
  &&observed.requestOrigin===r.canonicalRequestOrigin);}
