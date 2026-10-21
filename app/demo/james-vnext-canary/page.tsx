import type { Metadata } from 'next';
import JamesCanary from '@/components/james/JamesCanary';
import AgentAccessGate from '@/components/access/AgentAccessGate';
export const metadata: Metadata={title:'James vNext — Canary demo',robots:{index:false,follow:false}};
export default function Page(){return <AgentAccessGate agent="james"><JamesCanary/></AgentAccessGate>;}
