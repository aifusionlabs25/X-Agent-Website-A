
import { google } from 'googleapis';

export class GoogleSheetsService {
    private auth: any;
    private sheetId: string;

    constructor() {
        // Debug Env Vars (Masked)
        console.log('[GoogleSheets] 🔍 Checking Environment Variables:');
        console.log(`- GOOGLE_CLIENT_EMAIL: ${process.env.GOOGLE_CLIENT_EMAIL ? 'Set' : 'Missing'}`);
        console.log(`- GOOGLE_SERVICE_ACCOUNT_EMAIL: ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? 'Set' : 'Missing'}`);
        console.log(`- GOOGLE_PRIVATE_KEY: ${process.env.GOOGLE_PRIVATE_KEY ? 'Set' : 'Missing'}`);
        console.log(`- GOOGLE_SERVICE_ACCOUNT_KEY: ${process.env.GOOGLE_SERVICE_ACCOUNT_KEY ? 'Set' : 'Missing'}`);
        console.log(`- GOOGLE_SHEET_ID: ${process.env.GOOGLE_SHEET_ID ? 'Set' : 'Missing'}`);

        // Check for required Service Account credentials
        const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        const rawKey = process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
        const privateKey = rawKey?.replace(/\\n/g, '\n');

        this.sheetId = process.env.GOOGLE_SHEET_ID || '';

        if (clientEmail && privateKey) {
            this.auth = new google.auth.GoogleAuth({
                credentials: {
                    client_email: clientEmail,
                    private_key: privateKey,
                },
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            console.log('[GoogleSheets] ✅ Auth Configured');
        } else {
            console.warn('[GoogleSheets] ⚠️ Credentials missing. Logging disabled.');
        }
    }

    async appendLead(data: any): Promise<boolean> {
        if (!this.auth || !this.sheetId) {
            console.error('[GoogleSheets] ❌ Cannot append: Missing Auth or Sheet ID');
            return false;
        }

        try {
            const sheets = google.sheets({ version: 'v4', auth: this.auth });

            // Standard Layout (Insight IT Solutions)
            // Date, Time, ConvID, Name, Email, Phone, [InquiryType], [Budget/Timeline], [Status], [Blockers], [NextSteps], Recording
            const row = [
                new Date().toLocaleDateString(),
                new Date().toLocaleTimeString(),
                data.conversation_id || 'N/A',
                data.lead_name || 'N/A',
                data.lead_email || 'N/A',
                data.lead_phone || 'N/A',
                data.inquiry_type || 'N/A',
                `${data.budget || ''} | ${data.timeline || ''}`, // Summary Column
                data.qualification_status || 'N/A',
                (data.competitors_or_blockers || []).join(', '),
                (data.recommended_next_steps || []).join('; '),
                data.tavus_recording_url || 'N/A'
            ];

            await sheets.spreadsheets.values.append({
                spreadsheetId: this.sheetId,
                range: 'A:A', // Appends to the first sheet, first available row
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [row],
                },
            });

            console.log('[GoogleSheets] ✅ Row appended successfully.');
            return true;

        } catch (error: any) {
            console.error('[GoogleSheets] ❌ Append Failed:', error.message);
            return false;
        }
    }
}
