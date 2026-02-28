import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    if (process.env.MAINTENANCE_MODE === 'true') {
        // Return a sleek, branded HTML response
        return new NextResponse(
            `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>System Maintenance - AI Fusion Labs</title>
    <style>
        body {
            background-color: #09090b; /* Zinc 950 */
            color: #fff;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            text-align: center;
        }
        .container {
            max-width: 600px;
            padding: 40px;
        }
        .logo {
            font-size: 24px;
            font-weight: 700;
            letter-spacing: 0.1em;
            color: #fff;
            margin-bottom: 2rem;
            display: inline-block;
        }
        .dot { color: #4f46e5; } /* Indigo 600 */
        h1 {
            font-size: 2.5rem;
            font-weight: 300;
            margin-bottom: 1.5rem;
            letter-spacing: -0.02em;
        }
        p {
            color: #a1a1aa; /* Zinc 400 */
            font-size: 1.125rem;
            line-height: 1.6;
            font-weight: 300;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">AI FUSION LABS<span class="dot">.</span></div>
        <h1>System Upgrade in Progress</h1>
        <p>The X-Agent platform is currently down for scheduled maintenance and capability upgrades. We will be back online shortly.</p>
    </div>
</body>
</html>`,
            {
                status: 503,
                headers: { 'Content-Type': 'text/html' },
            }
        );
    }

    return NextResponse.next();
}

export const config = {
    // Apply to all routes except API, static files, and Next.js internals
    matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
