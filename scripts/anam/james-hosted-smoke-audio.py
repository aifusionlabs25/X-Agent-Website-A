"""Synthetic speech asset for exactly one hosted smoke; local flite, no inference."""
import json
import subprocess
import sys
import wave
from pathlib import Path

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=False)
turns = [
    'Hi James. My name is Morgan Hale. I was in a minor car accident this morning in Mesa. The police gave me a report.',
    'Actually, it was Tempe. My phone number is four eight zero, five five five, zero one three six.',
    'Should I call the insurer or talk to a lawyer first?',
    'I want help understanding my options after the collision. I decline to provide my email.',
    'Please prepare the information for the firm after we finish.',
    'Thanks, James. Goodbye.',
]
if '--intake-depth' in sys.argv:
    turns = [
        'Hello.',
        'I was in a minor car collision.',
        'It happened this morning in Tempe.',
        'My neck is sore. I went to urgent care and have their paperwork.',
        'An insurance adjuster left a voicemail. Should I call him back or talk to a lawyer first?',
        'My name is Morgan Hale. My phone number is four eight zero, five five five, zero one nine nine. Please read the number back.',
        'I want help understanding my options after the collision. I decline to provide my email.',
        'Will someone call me today?',
        'Please prepare the information for the firm after we finish.',
        'Thanks, James. Goodbye.',
    ]
for i, text in enumerate(turns):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
                    f"flite=text='{text}':voice=slt", '-ar', '16000', '-ac', '1', str(out / f'{i}.wav')], check=True)
silence = b'\0\0' * 16000
with wave.open(str(out / 'visitor.wav'), 'wb') as stream:
    stream.setnchannels(1)
    stream.setsampwidth(2)
    stream.setframerate(16000)
    stream.writeframes(silence * 15)
    for i in range(len(turns)):
        with wave.open(str(out / f'{i}.wav'), 'rb') as part:
            stream.writeframes(part.readframes(part.getnframes()))
        stream.writeframes(silence * 40)
    stream.writeframes(silence * 180)
(out / 'visitor-script.json').write_text(json.dumps(turns, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'turns': len(turns), 'model_calls': 0, 'audio': str(out / 'visitor.wav')}))
