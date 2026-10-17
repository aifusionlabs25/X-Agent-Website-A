import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import AnamPlayer from '../../components/AnamPlayer';
import { EVAN_PERSONA_ID } from '../../lib/anam/persona-ids';

const amy = new URLSearchParams(window.location.search).get('agent') === 'amy';
function Fixture() {
    const [closed, setClosed] = useState(false);
    return closed ? <div data-testid="session-exited">Session exited</div> : (
        <AnamPlayer personaId={amy ? 'fixture-amy-persona' : EVAN_PERSONA_ID}
            sessionVariant={amy ? 'amy-cara4' : undefined} onClose={() => setClosed(true)} />
    );
}
createRoot(document.getElementById('root')).render(<Fixture />);
