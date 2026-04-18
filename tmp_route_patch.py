import os
import re

file_path = r"C:\AI Fusion Labs\X AGENTS\REPOS\x-agent-website-a\app\api\save-transcript\route.ts"

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update the agent variables and move them up
agent_block_new = """        const agent = ALL_AGENTS.find(a => a.personaId === personaId);
        const agentName = agent ? agent.name : 'UnknownAgent';
        const agentRole = agent ? agent.role : 'AI Representative';
        const tenantName = agent?.tenant || 'AI Fusion Labs';
        const companyUrl = agent?.companyUrl || 'https://aifusionlabs.com/book-demo';
        const logoSrc = agent?.logoSrc ? `https://raw.githubusercontent.com/aifusionlabs25/X-Agent-Website-A/main/public${encodeURI(agent.logoSrc)}` : null;
        const msgCount = transcript.length;"""

# Insert agent lookup near the top
content = re.sub(
    r"(if \(transcript.length === 0\) \{\s+return.*?\}\s+)",
    r"\1\n" + agent_block_new + "\n",
    content,
    flags=re.DOTALL
)

# Remove the old agent lookup lower down
content = re.sub(
    r"\s+const agent = ALL_AGENTS.find\(a => a\.personaId === personaId\);\s+const agentName = agent \? agent\.name : 'UnknownAgent';\s+const agentRole = agent \? agent\.role : 'AI Representative';\n",
    "\n",
    content
)

# 2. Update sessionDate format
content = content.replace(
    "const sessionDate = new Date().toLocaleString();",
    "const sessionDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).format(new Date());"
)

# 3. Client Email template updates
client_email_search = r'<h2 style="color: #4F46E5; margin-top: 0;">Thanks for chatting!</h2>'
client_email_replace = r'''${logoSrc ? `<img src="${logoSrc}" alt="${tenantName} Logo" style="max-height: 45px; margin-bottom: 15px;" /><br>` : ''}
            <h2 style="color: #4F46E5; margin-top: 0;">Thanks for chatting!</h2>'''
content = content.replace(client_email_search, client_email_replace)

content = content.replace('href="https://aifusionlabs.com/book-demo"', 'href="${companyUrl}"')
content = content.replace('AI Fusion Labs\n            </p>', '${tenantName}\n            </p>')

# 4. Summary Email attachments and counts
# Update "File: ${filename}" to use attachmentFilename and add duration
content = content.replace(
    "<p style=\"margin: 4px 0;\"><strong>File:</strong> ${filename}</p>",
    "<p style=\"margin: 4px 0;\"><strong>File:</strong> ${attachmentFilename}</p>\n                <p style=\"margin: 4px 0;\"><strong>Session Length:</strong> ${msgCount} messages exchanged</p>"
)

# 5. Internal Intel HTML block
intel_block_search_start = r"<div style=\"background: #fffbeb; border: 1px solid #fef08a; padding: 20px; border-radius: 8px; margin-bottom: 25px;\">"
new_intel_blocks = r"""            <div style="background: #eff6ff; border: 2px solid #3b82f6; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
                <h3 style="color: #1d4ed8; font-size: 18px; margin-top: 0; display: flex; align-items: center;">🎯 Tailor-Made Sales Strategy</h3>
                <p style="white-space: pre-line; color: #1e3a8a; font-size: 15px;">
                    ${escapeHtml(leadData.tailor_made_sales_plan || 'No strategic plan generated.')}
                </p>
            </div>
            
            <div style="background: #f8fafc; border: 2px solid #94a3b8; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
                <h3 style="color: #334155; font-size: 16px; margin-top: 0;">📋 CRM Action Plan</h3>
                <p style="white-space: pre-line; color: #475569;">
                    ${escapeHtml(leadData.crm_action_plan || 'No designated CRM actions.')}
                </p>
            </div>

            <div style="background: #fffbeb; border: 1px solid #fef08a; padding: 20px; border-radius: 8px; margin-bottom: 25px;">"""
content = content.replace(intel_block_search_start, new_intel_blocks)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated route.ts successfully.")
