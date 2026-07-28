export function isEvanLocalTestMode(
    nodeEnv = process.env.NODE_ENV,
    enabled = process.env.NEXT_PUBLIC_EVAN_LOCAL_TEST_MODE,
): boolean {
    return nodeEnv === 'development' && enabled === 'true';
}