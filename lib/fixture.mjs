export const prefixes=[
 [{role:'user',content:'I have one bed and one desk. Do you reassemble either?'},
  {role:'user',content:'My name is Dana Reyes. My phone is 212-555-0174. My email is dana@example.test.'}],
];
prefixes.push([...prefixes[0],{role:'agent',content:'Would you like us to disassemble your bed and desk?'},{role:'user',content:'Yes please.'}]);
prefixes.push([...prefixes[1],{role:'user',content:'Cancel desk disassembly. Keep bed disassembly requested.'}]);
prefixes.push([...prefixes[2],{role:'user',content:'I will disassemble the bed myself; cancel that help. Please reassemble the desk at delivery.'}]);
prefixes.push([...prefixes[3],{role:'user',content:'Remove my email.'}]);
