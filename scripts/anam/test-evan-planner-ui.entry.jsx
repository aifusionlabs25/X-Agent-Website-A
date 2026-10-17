import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import AnamPlayer from '../../components/AnamPlayer';
import { EVAN_PERSONA_ID } from '../../lib/anam/persona-ids';
import EvanContactGate from '../../components/evan/EvanContactGate';

const amy = new URLSearchParams(window.location.search).get('agent') === 'amy';
function Fixture() {
    const [closed, setClosed] = useState(false);
    return closed ? <div data-testid="session-exited">Session exited</div> : (
        <AnamPlayer personaId={amy ? 'fixture-amy-persona' : EVAN_PERSONA_ID}
            sessionVariant={amy ? 'amy-cara4' : undefined} onClose={() => setClosed(true)} />
    );
}
const gate = new URLSearchParams(window.location.search).has('gate');
createRoot(document.getElementById('root')).render(gate ? <EvanContactGate><Fixture /></EvanContactGate> : <Fixture />);
